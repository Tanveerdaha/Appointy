/**
 * P0: Failed refund recovery — admin retry, reconcile-first, worker backoff/exhaustion.
 */
import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

let app
let User, Doctor, Appointment, StripePayment, RefundAudit, AppointmentHistory
let PAYMENT_STATUS, requestCancellation, ACTOR_TYPE
let retryOrReconcileFailedRefund, MAX_REFUND_AUTO_RETRIES, REFUND_AUDIT_ACTION
let processDueRefundRetries

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test_jwt_secret'
  process.env.JWT_PATIENT_SECRET = 'test_patient_secret'
  process.env.JWT_DOCTOR_SECRET = 'test_doctor_secret'
  process.env.JWT_ADMIN_SECRET = 'test_admin_secret'
  process.env.ACCESS_TOKEN_EXPIRES = '15m'
  process.env.REFRESH_TOKEN_EXPIRES = '30d'
  process.env.JWT_ACCEPT_LEGACY = 'true'
  process.env.ADMIN_EMAIL = 'admin@test.com'
  process.env.ADMIN_PASSWORD = 'password123'
  process.env.DB_DIALECT = 'sqlite'
  process.env.SQLITE_STORAGE = ':memory:'
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit_stripe_secret'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_stripe_webhooks'
  process.env.CURRENCY = 'pkr'
  process.env.FRONTEND_URL = 'http://localhost:5173'
  process.env.FULL_REFUND_HOURS = '24'
  process.env.PARTIAL_REFUND_HOURS = '2'
  process.env.PARTIAL_REFUND_PERCENT = '50'
  process.env.SCHEDULING_TIMEZONE = 'Asia/Karachi'
  process.env.REFUND_RETRY_WORKER_ENABLED = 'false'

  const { createApp, initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  Appointment = (await import('../models/appointmentModel.js')).default
  AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default
  RefundAudit = (await import('../models/refundAuditModel.js')).default
  const auditModel = await import('../models/refundAuditModel.js')
  REFUND_AUDIT_ACTION = auditModel.REFUND_AUDIT_ACTION
  const paymentModel = await import('../models/stripePaymentModel.js')
  StripePayment = paymentModel.default
  PAYMENT_STATUS = paymentModel.PAYMENT_STATUS

  const cancel = await import('../services/cancellationService.js')
  requestCancellation = cancel.requestCancellation
  ACTOR_TYPE = cancel.ACTOR_TYPE

  const refund = await import('../services/refundService.js')
  retryOrReconcileFailedRefund = refund.retryOrReconcileFailedRefund
  MAX_REFUND_AUTO_RETRIES = refund.MAX_REFUND_AUTO_RETRIES

  ;({ processDueRefundRetries } = await import('../services/refundRetryWorker.js'))

  await initServices()
  app = createApp()
})

beforeEach(async () => {
  await RefundAudit.destroy({ where: {}, truncate: true })
  await StripePayment.destroy({ where: {}, truncate: true })
  await AppointmentHistory.destroy({ where: {}, truncate: true })
  await Appointment.destroy({ where: {}, truncate: true })
  await Doctor.destroy({ where: {}, truncate: true })
  await User.destroy({ where: {}, truncate: true })
})

const adminToken = () =>
  jwt.sign(
    { role: 'admin', email: process.env.ADMIN_EMAIL, tokenType: 'access' },
    process.env.JWT_ADMIN_SECRET,
    {
      subject: process.env.ADMIN_EMAIL,
      issuer: 'appointy-auth',
      audience: 'appointy-admin-api',
      expiresIn: '1h',
    }
  )

const seedPaidAppointment = async ({
  amount = 2000,
  paymentIntentId = null,
} = {}) => {
  const hashed = await bcrypt.hash('password123', 10)
  const user = await User.create({
    name: 'Patient',
    email: `patient_${Date.now()}_${Math.random()}@test.com`,
    password: hashed,
  })
  const doctor = await Doctor.create({
    name: 'Dr Retry',
    email: `doc_${Date.now()}_${Math.random()}@test.com`,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Retry doctor',
    fees: amount,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    slots_booked: {},
  })
  const pi = paymentIntentId || `pi_retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const appointment = await Appointment.create({
    userId: user.id,
    docId: doctor.id,
    userData: { id: user.id, name: user.name, email: user.email },
    docData: {
      id: doctor.id,
      name: doctor.name,
      fees: amount,
      address: doctor.address,
      image: doctor.image,
      speciality: doctor.speciality,
    },
    amount,
    slotTime: '10:00 AM',
    slotDate: '20_7_2026',
    startTime: new Date(Date.now() + 48 * 60 * 60 * 1000),
    heldStartTime: new Date(Date.now() + 48 * 60 * 60 * 1000),
    status: 'CONFIRMED',
    statusChangedAt: new Date(),
    date: Date.now(),
    payment: true,
    paymentStatus: 'paid',
    cancelled: false,
    stripePaymentIntentId: pi,
  })

  const payment = await StripePayment.create({
    appointmentId: appointment.id,
    userId: user.id,
    stripeCheckoutSessionId: `cs_${appointment.id}`,
    stripePaymentIntentId: pi,
    amount: amount * 100,
    currency: 'pkr',
    status: PAYMENT_STATUS.PAID,
    paidAt: new Date(),
    activeAppointmentId: null,
    refundRetryCount: 0,
  })

  return { user, doctor, appointment, payment }
}

const mockRefundCreate = (overrides = {}) => {
  let calls = 0
  const keys = []
  const createRefundFn = async (params, options) => {
    calls += 1
    keys.push(options?.idempotencyKey)
    if (typeof overrides.onCall === 'function') {
      return overrides.onCall(params, options, calls)
    }
    if (overrides.throwOnCall && overrides.throwOnCall(calls)) {
      throw Object.assign(new Error(overrides.throwMessage || 'stripe_down'), {
        code: 'stripe_unavailable',
      })
    }
    return {
      id: `re_retry_${calls}`,
      object: 'refund',
      amount: overrides.amount ?? params?.amount ?? 200000,
      status: overrides.status ?? 'succeeded',
      payment_intent: params?.payment_intent || 'pi_retry',
      charge: 'ch_retry',
      ...(overrides.refund || {}),
    }
  }
  createRefundFn.calls = () => calls
  createRefundFn.keys = () => keys
  return createRefundFn
}

describe('Failed refund recovery', () => {
  test('cancel → REFUND_FAILED → second cancel blocked → admin retry succeeds', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_recovery_1',
    })

    const failThenSucceed = mockRefundCreate({
      onCall: (_params, _opts, call) => {
        if (call === 1) {
          throw Object.assign(new Error('stripe_unavailable'), { code: 'stripe_unavailable' })
        }
        return {
          id: 're_recovery_ok',
          object: 'refund',
          amount: 200000,
          status: 'succeeded',
          payment_intent: 'pi_recovery_1',
          charge: 'ch_ok',
        }
      },
    })

    await expect(
      requestCancellation({
        appointmentId: appointment.id,
        actorType: ACTOR_TYPE.ADMIN,
        reason: 'Clinic closed',
        createRefundFn: failThenSucceed,
        expireCheckout: false,
      })
    ).rejects.toMatchObject({ code: 'stripe_refund_failed' })

    await appointment.reload()
    await payment.reload()
    expect(appointment.status).toBe('CANCELLED')
    expect(payment.status).toBe(PAYMENT_STATUS.REFUND_FAILED)
    expect(payment.refundNextRetryAt).not.toBeNull()
    expect(payment.refundLastError).toMatch(/stripe_unavailable/)

    await expect(
      requestCancellation({
        appointmentId: appointment.id,
        actorType: ACTOR_TYPE.ADMIN,
        reason: 'Retry via cancel',
        createRefundFn: failThenSucceed,
        expireCheckout: false,
      })
    ).rejects.toMatchObject({ code: 'already_cancelled' })
    expect(failThenSucceed.calls()).toBe(1)

    const result = await retryOrReconcileFailedRefund({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.ADMIN,
      force: true,
      createRefundFn: failThenSucceed,
      listRefundsFn: async () => [],
      retrieveRefundFn: async () => {
        throw new Error('no stored refund')
      },
    })

    expect(result.outcome).toBe('retried')
    await payment.reload()
    await appointment.reload()
    expect(payment.status).toBe(PAYMENT_STATUS.REFUNDED)
    expect(appointment.paymentStatus).toBe('refunded')
    expect(failThenSucceed.calls()).toBe(2)
    expect(failThenSucceed.keys()[1]).toMatch(/_r1$/)

    const retryAudit = await RefundAudit.findOne({
      where: {
        appointmentId: appointment.id,
        action: REFUND_AUDIT_ACTION.REFUND_RETRY_REQUESTED,
      },
    })
    expect(retryAudit).not.toBeNull()
  })

  test('admin HTTP retry-refund requires auth and valid appointmentId', async () => {
    const { appointment } = await seedPaidAppointment({ paymentIntentId: 'pi_http_val' })

    const unauth = await request(app)
      .post('/api/admin/retry-refund')
      .send({ appointmentId: appointment.id })
    expect(unauth.status).toBe(401)

    const badBody = await request(app)
      .post('/api/admin/retry-refund')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({})
    expect(badBody.status).toBe(400)
  })

  test('reconcile-only: local REFUND_FAILED but Stripe refund already succeeded', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_reconcile_1',
    })
    await appointment.update({
      status: 'CANCELLED',
      cancelled: true,
      heldStartTime: null,
      paymentStatus: 'refund_failed',
    })
    await payment.update({
      status: PAYMENT_STATUS.REFUND_FAILED,
      refundAmount: 200000,
      refundReason: 'Clinic closed',
      stripeRefundId: 're_already_ok',
      refundLastError: 'network blip',
      refundNextRetryAt: new Date(Date.now() - 1000),
      refundRetryCount: 1,
    })

    let createCalls = 0
    const result = await retryOrReconcileFailedRefund({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.ADMIN,
      force: true,
      createRefundFn: async () => {
        createCalls += 1
        throw new Error('should not create')
      },
      retrieveRefundFn: async (id) => ({
        id,
        object: 'refund',
        amount: 200000,
        status: 'succeeded',
        payment_intent: 'pi_reconcile_1',
        charge: 'ch_reconcile',
      }),
    })

    expect(result.outcome).toBe('reconciled')
    expect(createCalls).toBe(0)
    await payment.reload()
    await appointment.reload()
    expect(payment.status).toBe(PAYMENT_STATUS.REFUNDED)
    expect(appointment.paymentStatus).toBe('refunded')
  })

  test('idempotent retry when already REFUNDED', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_already_refunded',
    })
    await payment.update({
      status: PAYMENT_STATUS.REFUNDED,
      refundAmount: 200000,
      refundedAt: new Date(),
      stripeRefundId: 're_done',
    })
    await appointment.update({ paymentStatus: 'refunded', payment: false })

    const result = await retryOrReconcileFailedRefund({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.ADMIN,
      force: true,
      createRefundFn: async () => {
        throw new Error('should not create')
      },
    })

    expect(result.outcome).toBe('already_refunded')
  })

  test('worker processes due REFUND_FAILED; exhaustion stops auto-retry; admin force still works', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_worker_1',
    })
    await appointment.update({
      status: 'CANCELLED',
      cancelled: true,
      heldStartTime: null,
      paymentStatus: 'refund_failed',
    })
    await payment.update({
      status: PAYMENT_STATUS.REFUND_FAILED,
      refundAmount: 200000,
      refundReason: 'Clinic closed',
      refundLastError: 'stripe_down',
      refundNextRetryAt: new Date(Date.now() - 1000),
      refundRetryCount: 0,
      stripeRefundId: null,
    })

    const alwaysFail = mockRefundCreate({
      throwOnCall: () => true,
      throwMessage: 'still_down',
    })

    const tick1 = await processDueRefundRetries({
      createRefundFn: alwaysFail,
      listRefundsFn: async () => [],
      retrieveRefundFn: async () => {
        throw new Error('none')
      },
    })
    expect(tick1[0].ok).toBe(false)
    await payment.reload()
    expect(payment.status).toBe(PAYMENT_STATUS.REFUND_FAILED)
    expect(payment.refundRetryCount).toBe(1)
    expect(payment.refundNextRetryAt).not.toBeNull()

    // Not due yet — worker skips
    const tickEarly = await processDueRefundRetries({
      createRefundFn: alwaysFail,
      listRefundsFn: async () => [],
    })
    expect(tickEarly).toHaveLength(0)

    // Exhaust remaining retries
    for (let i = payment.refundRetryCount; i < MAX_REFUND_AUTO_RETRIES; i += 1) {
      await payment.update({ refundNextRetryAt: new Date(Date.now() - 1000) })
      await processDueRefundRetries({
        createRefundFn: alwaysFail,
        listRefundsFn: async () => [],
        retrieveRefundFn: async () => {
          throw new Error('none')
        },
      })
      await payment.reload()
    }

    expect(payment.refundRetryCount).toBe(MAX_REFUND_AUTO_RETRIES)
    expect(payment.refundNextRetryAt).toBeNull()

    const exhaustedAudit = await RefundAudit.findOne({
      where: {
        appointmentId: appointment.id,
        action: REFUND_AUDIT_ACTION.REFUND_RETRY_EXHAUSTED,
      },
    })
    expect(exhaustedAudit).not.toBeNull()

    // Auto worker finds nothing after exhaustion
    await payment.update({ refundNextRetryAt: new Date(Date.now() - 1000) })
    const afterExhaust = await processDueRefundRetries({
      createRefundFn: alwaysFail,
      listRefundsFn: async () => [],
    })
    expect(afterExhaust).toHaveLength(0)

    // Admin force still works
    const succeed = mockRefundCreate({ status: 'succeeded' })
    const forced = await retryOrReconcileFailedRefund({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.ADMIN,
      force: true,
      createRefundFn: succeed,
      listRefundsFn: async () => [],
      retrieveRefundFn: async () => {
        throw new Error('none')
      },
    })
    expect(forced.outcome).toBe('retried')
    await payment.reload()
    expect(payment.status).toBe(PAYMENT_STATUS.REFUNDED)
  })

  test('concurrent retries: only one Stripe create', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_concurrent_retry',
    })
    await appointment.update({
      status: 'CANCELLED',
      cancelled: true,
      heldStartTime: null,
      paymentStatus: 'refund_failed',
    })
    await payment.update({
      status: PAYMENT_STATUS.REFUND_FAILED,
      refundAmount: 200000,
      refundReason: 'Clinic closed',
      refundNextRetryAt: new Date(Date.now() - 1000),
      refundRetryCount: 0,
      stripeRefundId: null,
    })

    const createRefundFn = mockRefundCreate({
      status: 'succeeded',
      onCall: async (params) => {
        await new Promise((r) => setTimeout(r, 30))
        return {
          id: 're_concurrent_1',
          object: 'refund',
          amount: params.amount,
          status: 'succeeded',
          payment_intent: params.payment_intent,
          charge: 'ch_c',
        }
      },
    })

    const results = await Promise.allSettled([
      retryOrReconcileFailedRefund({
        appointmentId: appointment.id,
        actorType: ACTOR_TYPE.SYSTEM,
        force: true,
        createRefundFn,
        listRefundsFn: async () => [],
        retrieveRefundFn: async () => {
          throw new Error('none')
        },
      }),
      retryOrReconcileFailedRefund({
        appointmentId: appointment.id,
        actorType: ACTOR_TYPE.SYSTEM,
        force: true,
        createRefundFn,
        listRefundsFn: async () => [],
        retrieveRefundFn: async () => {
          throw new Error('none')
        },
      }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)
    expect(fulfilled.length + rejected.length).toBe(2)
    if (rejected.length) {
      expect(rejected[0].reason.code).toMatch(/refund_pending|not_refund_failed|already_refunded/)
    }
    expect(createRefundFn.calls()).toBe(1)

    await payment.reload()
    expect(payment.status).toBe(PAYMENT_STATUS.REFUNDED)
  })
})
