/**
 * Cancellation + refund reconciliation tests.
 */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals'
import request from 'supertest'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import Stripe from 'stripe'

const WEBHOOK_SECRET = 'whsec_test_secret_for_stripe_webhooks'
const STRIPE_SECRET = 'sk_test_unit_stripe_secret'
const stripe = new Stripe(STRIPE_SECRET)

let app
let User, Doctor, Appointment, StripePayment, StripeWebhookEvent, AppointmentHistory, RefundAudit
let PAYMENT_STATUS, requestCancellation, ACTOR_TYPE, APPOINTMENT_STATUS

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
  process.env.STRIPE_SECRET_KEY = STRIPE_SECRET
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.CURRENCY = 'pkr'
  process.env.FRONTEND_URL = 'http://localhost:5173'
  process.env.FULL_REFUND_HOURS = '24'
  process.env.PARTIAL_REFUND_HOURS = '2'
  process.env.PARTIAL_REFUND_PERCENT = '50'
  process.env.SCHEDULING_UTC_OFFSET_MINUTES = '300'

  const { createApp, initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  Appointment = (await import('../models/appointmentModel.js')).default
  AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default
  StripeWebhookEvent = (await import('../models/stripeWebhookEventModel.js')).default
  RefundAudit = (await import('../models/refundAuditModel.js')).default
  const paymentModel = await import('../models/stripePaymentModel.js')
  StripePayment = paymentModel.default
  PAYMENT_STATUS = paymentModel.PAYMENT_STATUS

  const cancel = await import('../services/cancellationService.js')
  requestCancellation = cancel.requestCancellation
  ACTOR_TYPE = cancel.ACTOR_TYPE
  APPOINTMENT_STATUS = cancel.APPOINTMENT_STATUS

  await initServices()
  app = createApp()
})

beforeEach(async () => {
  await RefundAudit.destroy({ where: {}, truncate: true })
  await StripePayment.destroy({ where: {}, truncate: true })
  await StripeWebhookEvent.destroy({ where: {}, truncate: true })
  await AppointmentHistory.destroy({ where: {}, truncate: true })
  await Appointment.destroy({ where: {}, truncate: true })
  await Doctor.destroy({ where: {}, truncate: true })
  await User.destroy({ where: {}, truncate: true })
})

const seedPaidAppointment = async ({
  amount = 2000,
  startTime = new Date(Date.now() + 48 * 60 * 60 * 1000),
  paymentStatus = 'paid',
  status = 'CONFIRMED',
  paymentIntentId = null,
} = {}) => {
  const hashed = await bcrypt.hash('password123', 10)
  const user = await User.create({
    name: 'Patient',
    email: `patient_${Date.now()}_${Math.random()}@test.com`,
    password: hashed,
  })
  const doctor = await Doctor.create({
    name: 'Dr Refund',
    email: `doc_${Date.now()}_${Math.random()}@test.com`,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Refund doctor',
    fees: amount,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    slots_booked: {},
  })
  const pi = paymentIntentId || `pi_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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
    startTime,
    heldStartTime: status === 'CANCELLED' ? null : startTime,
    status,
    statusChangedAt: new Date(),
    date: Date.now(),
    payment: paymentStatus === 'paid',
    paymentStatus,
    cancelled: status === 'CANCELLED',
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
  })

  return { user, doctor, appointment, payment }
}

const mockRefundCreate = (overrides = {}) => {
  let calls = 0
  const createRefundFn = async (params) => {
    calls += 1
    return {
      id: `re_test_${calls}`,
      object: 'refund',
      amount: overrides.amount ?? params?.amount ?? 200000,
      status: overrides.status ?? 'pending',
      payment_intent: params?.payment_intent || 'pi_test_refund_1',
      charge: 'ch_test_1',
      ...overrides,
    }
  }
  createRefundFn.calls = () => calls
  return createRefundFn
}

const postWebhook = async (event) => {
  const payload = JSON.stringify(event)
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  })
  return request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', header)
    .send(payload)
}

describe('Paid appointment cancellation + refund', () => {
  test('Test 1: paid cancellation creates refund and sets REFUND_PENDING', async () => {
    const { appointment, payment } = await seedPaidAppointment()
    const createRefundFn = mockRefundCreate({ status: 'pending', amount: 200000 })

    const result = await requestCancellation({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.USER,
      actorId: appointment.userId,
      createRefundFn,
      expireCheckout: false,
    })

    expect(result.refundRequired).toBe(true)
    expect(result.appointment.status).toBe(APPOINTMENT_STATUS.CANCELLED)
    expect(result.appointment.paymentStatus).toBe('refund_pending')
    expect(result.appointment.payment).toBe(true)
    expect(createRefundFn.calls()).toBe(1)

    await payment.reload()
    expect(payment.status).toBe(PAYMENT_STATUS.REFUND_PENDING)
    expect(payment.stripeRefundId).toBe('re_test_1')
    expect(payment.refundAmount).toBe(200000)

    const audits = await RefundAudit.findAll({ where: { appointmentId: appointment.id } })
    expect(audits.length).toBeGreaterThan(0)
  })

  test('Test 2: charge.refunded webhook marks payment REFUNDED', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_webhook_success',
    })
    await payment.update({
      status: PAYMENT_STATUS.REFUND_PENDING,
      stripeRefundId: 're_test_webhook',
      refundAmount: 200000,
      refundStatus: 'pending',
    })
    await appointment.update({
      status: 'CANCELLED',
      cancelled: true,
      cancelledAt: new Date(),
      heldStartTime: null,
      paymentStatus: 'refund_pending',
      payment: true,
    })

    const event = {
      id: 'evt_refund_success_1',
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_test_1',
          object: 'charge',
          payment_intent: 'pi_webhook_success',
          amount_refunded: 200000,
        },
      },
    }

    const res = await postWebhook(event)
    expect(res.status).toBe(200)

    await payment.reload()
    await appointment.reload()
    expect(payment.status).toBe(PAYMENT_STATUS.REFUNDED)
    expect(appointment.paymentStatus).toBe('refunded')
    expect(appointment.payment).toBe(false)
    expect(appointment.status).toBe('CANCELLED')
  })

  test('Test 3: admin cannot bypass refund on paid appointment', async () => {
    const { appointment } = await seedPaidAppointment()
    const createRefundFn = mockRefundCreate({ status: 'pending' })

    // Missing reason → rejected
    await expect(
      requestCancellation({
        appointmentId: appointment.id,
        actorType: ACTOR_TYPE.ADMIN,
        reason: '',
        createRefundFn,
        expireCheckout: false,
      })
    ).rejects.toMatchObject({ code: 'refund_reason_required' })

    const result = await requestCancellation({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.ADMIN,
      reason: 'Clinic schedule change',
      createRefundFn,
      expireCheckout: false,
    })

    expect(result.refundRequired).toBe(true)
    expect(result.appointment.status).toBe('CANCELLED')
    expect(result.appointment.paymentStatus).toBe('refund_pending')
    expect(createRefundFn.calls()).toBe(1)

    // HTTP path also requires reason for paid
    const adminToken = jwt.sign(
      { role: 'admin', email: process.env.ADMIN_EMAIL, tokenType: 'access' },
      process.env.JWT_ADMIN_SECRET,
      {
        subject: process.env.ADMIN_EMAIL,
        issuer: 'appointy-auth',
        audience: 'appointy-admin-api',
        expiresIn: '1h',
      }
    )
    const paid2 = await seedPaidAppointment({
      startTime: new Date(Date.now() + 72 * 60 * 60 * 1000),
      paymentIntentId: 'pi_admin_http_1',
    })

    const noReason = await request(app)
      .post('/api/admin/cancel-appointment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ appointmentId: paid2.appointment.id })
    expect(noReason.status).toBe(400)
    expect(noReason.body.code).toBe('refund_reason_required')
  })

  test('Test 4: doctor cancellation triggers full refund workflow', async () => {
    const { appointment, doctor } = await seedPaidAppointment({
      paymentIntentId: 'pi_doctor_1',
    })

    const createRefundFn = mockRefundCreate({ status: 'pending', amount: 200000 })
    const result = await requestCancellation({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.DOCTOR,
      actorId: doctor.id,
      reason: 'DOCTOR_UNAVAILABLE',
      createRefundFn,
      expireCheckout: false,
    })

    expect(result.refundRequired).toBe(true)
    expect(result.eligibility.refundPercent).toBe(100)
    expect(result.appointment.status).toBe('CANCELLED')
    expect(result.appointment.paymentStatus).toBe('refund_pending')
  })

  test('Test 5: unpaid cancellation cancels without refund', async () => {
    const hashed = await bcrypt.hash('password123', 10)
    const user = await User.create({
      name: 'Patient',
      email: `unpaid_${Date.now()}@test.com`,
      password: hashed,
    })
    const doctor = await Doctor.create({
      name: 'Dr Unpaid',
      email: `doc_unpaid_${Date.now()}@test.com`,
      password: hashed,
      image: 'img.png',
      speciality: 'General physician',
      degree: 'MBBS',
      experience: '5 Year',
      about: 'Unpaid',
      fees: 500,
      address: { line1: 'A', line2: 'B' },
      date: Date.now(),
      slots_booked: {},
    })
    const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const appointment = await Appointment.create({
      userId: user.id,
      docId: doctor.id,
      userData: { id: user.id, name: user.name, email: user.email },
      docData: { id: doctor.id, name: doctor.name, fees: 500, address: doctor.address, image: doctor.image, speciality: doctor.speciality },
      amount: 500,
      slotTime: '10:00 AM',
      slotDate: '20_7_2026',
      startTime,
      heldStartTime: startTime,
      status: 'CONFIRMED',
      statusChangedAt: new Date(),
      date: Date.now(),
      payment: false,
      paymentStatus: 'unpaid',
    })

    const createRefundFn = mockRefundCreate()
    const result = await requestCancellation({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.USER,
      actorId: user.id,
      createRefundFn,
      expireCheckout: false,
    })

    expect(result.refundRequired).toBe(false)
    expect(result.appointment.status).toBe('CANCELLED')
    expect(result.appointment.paymentStatus).toBe('unpaid')
    expect(createRefundFn.calls()).toBe(0)

    const payments = await StripePayment.findAll({ where: { appointmentId: appointment.id } })
    expect(payments).toHaveLength(0)
  })

  test('Test 6: Stripe refund failure does not cancel appointment', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_fail_1',
    })

    const createRefundFn = async () => {
      throw new Error('Stripe refund API error')
    }

    await expect(
      requestCancellation({
        appointmentId: appointment.id,
        actorType: ACTOR_TYPE.ADMIN,
        reason: 'Admin cancel',
        createRefundFn,
        expireCheckout: false,
      })
    ).rejects.toMatchObject({ code: 'stripe_refund_failed' })

    await appointment.reload()
    await payment.reload()
    expect(appointment.status).toBe('CONFIRMED')
    expect(appointment.cancelled).toBe(false)
    expect(payment.status).toBe(PAYMENT_STATUS.REFUND_FAILED)
    expect(appointment.paymentStatus).toBe('refund_failed')
  })

  test('Test 7: duplicate refund request creates only one Stripe refund', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_dup_1',
    })

    const createRefundFn = mockRefundCreate({ status: 'pending' })

    const first = await requestCancellation({
      appointmentId: appointment.id,
      actorType: ACTOR_TYPE.ADMIN,
      reason: 'First cancel',
      createRefundFn,
      expireCheckout: false,
    })
    expect(first.refundRequired).toBe(true)
    expect(createRefundFn.calls()).toBe(1)

    await expect(
      requestCancellation({
        appointmentId: appointment.id,
        actorType: ACTOR_TYPE.ADMIN,
        reason: 'Second cancel',
        createRefundFn,
        expireCheckout: false,
      })
    ).rejects.toMatchObject({ code: 'already_cancelled' })

    expect(createRefundFn.calls()).toBe(1)

    await payment.reload()
    expect(payment.stripeRefundId).toBe('re_test_1')
  })

  test('refund.updated failed webhook sets REFUND_FAILED', async () => {
    const { appointment, payment } = await seedPaidAppointment({
      paymentIntentId: 'pi_webhook_fail',
    })
    await payment.update({
      status: PAYMENT_STATUS.REFUND_PENDING,
      stripeRefundId: 're_fail_1',
    })
    await appointment.update({
      status: 'CANCELLED',
      cancelled: true,
      heldStartTime: null,
      paymentStatus: 'refund_pending',
    })

    const event = {
      id: 'evt_refund_fail_1',
      object: 'event',
      type: 'refund.updated',
      data: {
        object: {
          id: 're_fail_1',
          object: 'refund',
          status: 'failed',
          amount: 200000,
          payment_intent: 'pi_webhook_fail',
          charge: 'ch_fail',
        },
      },
    }

    const res = await postWebhook(event)
    expect(res.status).toBe(200)

    await payment.reload()
    await appointment.reload()
    expect(payment.status).toBe(PAYMENT_STATUS.REFUND_FAILED)
    expect(appointment.paymentStatus).toBe('refund_failed')
  })
})
