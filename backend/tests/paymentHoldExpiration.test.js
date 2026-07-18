/**
 * P1: Server-owned PENDING_PAYMENT hold expiration.
 * Ensures abandoned / Stripe-failed holds release the doctor slot.
 */
import bcrypt from 'bcrypt'
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals'

let User, Doctor, Appointment, AppointmentHistory, StripePayment
let createAppointment, createAppointmentPayment
let APPOINTMENT_STATUS, APPOINTMENT_PAYMENT_STATUS, PAYMENT_STATUS
let getHoldExpiryMs, releaseExpiredPaymentHolds, processDuePaymentHolds

const FUTURE_START = new Date('2030-07-22T10:00:00+05:00')
const FUTURE_START_B = new Date('2030-07-22T10:30:00+05:00')

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
  process.env.SCHEDULING_TIMEZONE = 'Asia/Karachi'
  process.env.CURRENCY = 'pkr'
  process.env.FRONTEND_URL = 'http://localhost:5173'
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit_stripe_secret'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  process.env.APPOINTMENT_HOLD_EXPIRY_MINUTES = '60'
  process.env.PAYMENT_HOLD_WORKER_ENABLED = 'false'
  process.env.REFUND_RETRY_WORKER_ENABLED = 'false'

  const { initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  Appointment = (await import('../models/appointmentModel.js')).default
  AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default
  const paymentModel = await import('../models/stripePaymentModel.js')
  StripePayment = paymentModel.default
  PAYMENT_STATUS = paymentModel.PAYMENT_STATUS
  APPOINTMENT_PAYMENT_STATUS = paymentModel.APPOINTMENT_PAYMENT_STATUS
  ;({ APPOINTMENT_STATUS } = await import('../models/appointmentModel.js'))
  ;({ createAppointment } = await import('../services/appointmentService.js'))
  ;({ createAppointmentPayment } = await import('../services/paymentService.js'))
  ;({ getHoldExpiryMs, releaseExpiredPaymentHolds } = await import(
    '../services/paymentHoldService.js'
  ))
  ;({ processDuePaymentHolds } = await import('../services/paymentHoldWorker.js'))

  await initServices()
})

beforeEach(async () => {
  const RefundAudit = (await import('../models/refundAuditModel.js')).default
  await RefundAudit.destroy({ where: {}, truncate: true })
  await StripePayment.destroy({ where: {}, truncate: true })
  await AppointmentHistory.destroy({ where: {}, truncate: true })
  await Appointment.destroy({ where: {}, truncate: true })
  await Doctor.destroy({ where: {}, truncate: true })
  await User.destroy({ where: {}, truncate: true })
})

const seedUser = async (email = `patient_${Date.now()}_${Math.random()}@test.com`) => {
  const hashed = await bcrypt.hash('password123', 10)
  return User.create({ name: 'Patient', email, password: hashed })
}

const seedDoctor = async (email = `doc_${Date.now()}_${Math.random()}@test.com`) => {
  const hashed = await bcrypt.hash('password123', 10)
  return Doctor.create({
    name: 'Dr Hold',
    email,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Hold doctor',
    fees: 500,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    available: true,
    slots_booked: {},
  })
}

describe('PENDING_PAYMENT hold expiration', () => {
  test('pay-now booking sets holdExpiresAt near now + TTL', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    const before = Date.now()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'now',
    })

    expect(appointment.status).toBe(APPOINTMENT_STATUS.PENDING_PAYMENT)
    expect(appointment.holdExpiresAt).toBeTruthy()
    const expiresMs = new Date(appointment.holdExpiresAt).getTime()
    const ttl = getHoldExpiryMs()
    expect(expiresMs).toBeGreaterThanOrEqual(before + ttl - 5_000)
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + ttl + 5_000)
  })

  test('pay-later booking leaves holdExpiresAt null', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })

    expect(appointment.status).toBe(APPOINTMENT_STATUS.CONFIRMED)
    expect(appointment.holdExpiresAt).toBeNull()
  })

  test('Stripe failure keeps appointment with pending_retry and holdExpiresAt', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'now',
    })
    const holdBefore = appointment.holdExpiresAt

    const result = await createAppointmentPayment(
      { appointmentId: appointment.id, userId: user.id },
      {
        createSession: async () => {
          throw new Error('Stripe timeout')
        },
      }
    )

    expect(result.ok).toBe(false)
    expect(result.code).toBe('stripe_unavailable')
    expect(result.retryable).toBe(true)

    await appointment.reload()
    expect(appointment.status).toBe(APPOINTMENT_STATUS.PENDING_PAYMENT)
    expect(appointment.paymentStatus).toBe(APPOINTMENT_PAYMENT_STATUS.PENDING_RETRY)
    expect(appointment.heldStartTime).toBeTruthy()
    expect(appointment.holdExpiresAt).toBeTruthy()
    expect(new Date(appointment.holdExpiresAt).getTime()).toBe(new Date(holdBefore).getTime())
  })

  test('due hold is cancelled, slot cleared, and slot can be rebooked', async () => {
    const user = await seedUser()
    const other = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'now',
    })

    await appointment.update({ holdExpiresAt: new Date(Date.now() - 60_000) })

    const results = await releaseExpiredPaymentHolds({
      now: new Date(),
      expireCheckout: false,
    })
    expect(results).toHaveLength(1)
    expect(results[0].outcome).toBe('released')

    await appointment.reload()
    expect(appointment.status).toBe(APPOINTMENT_STATUS.CANCELLED)
    expect(appointment.heldStartTime).toBeNull()
    expect(appointment.holdExpiresAt).toBeNull()

    const rebooked = await createAppointment({
      doctorId: doctor.id,
      userId: other.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })
    expect(rebooked.id).toBeTruthy()
    expect(rebooked.status).toBe(APPOINTMENT_STATUS.CONFIRMED)
  })

  test('not-yet-due hold is left alone', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'now',
    })

    const results = await processDuePaymentHolds({
      now: new Date(),
      expireCheckout: false,
    })
    expect(results).toHaveLength(0)

    await appointment.reload()
    expect(appointment.status).toBe(APPOINTMENT_STATUS.PENDING_PAYMENT)
    expect(appointment.heldStartTime).toBeTruthy()
  })

  test('paid and already-cancelled appointments are ignored', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const paid = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })
    await paid.update({
      status: APPOINTMENT_STATUS.PENDING_PAYMENT,
      paymentStatus: 'paid',
      payment: true,
      holdExpiresAt: new Date(Date.now() - 60_000),
    })

    const cancelled = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START_B,
      payMode: 'now',
    })
    await cancelled.update({
      status: APPOINTMENT_STATUS.CANCELLED,
      cancelled: true,
      heldStartTime: null,
      holdExpiresAt: new Date(Date.now() - 60_000),
    })

    const results = await releaseExpiredPaymentHolds({
      now: new Date(),
      expireCheckout: false,
    })

    // Paid row still matches findDue (PENDING_PAYMENT + due), but release is a no-op.
    const paidResult = results.find((r) => r.appointmentId === paid.id)
    expect(paidResult?.outcome).toBe('already_paid')

    await paid.reload()
    expect(paid.status).toBe(APPOINTMENT_STATUS.PENDING_PAYMENT)
    expect(paid.heldStartTime).toBeTruthy()

    // Cancelled is excluded from the due query (status filter).
    expect(results.find((r) => r.appointmentId === cancelled.id)).toBeUndefined()
  })

  test('createAppointmentPayment after hold expiry returns hold_expired and releases', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'now',
    })
    await appointment.update({ holdExpiresAt: new Date(Date.now() - 1_000) })

    const result = await createAppointmentPayment(
      { appointmentId: appointment.id, userId: user.id },
      {
        createSession: async () => {
          throw new Error('should not reach Stripe')
        },
      }
    )

    expect(result.ok).toBe(false)
    expect(result.code).toBe('hold_expired')
    expect(result.retryable).toBe(false)

    await appointment.reload()
    expect(appointment.status).toBe(APPOINTMENT_STATUS.CANCELLED)
    expect(appointment.heldStartTime).toBeNull()

    const payments = await StripePayment.findAll({ where: { appointmentId: appointment.id } })
    expect(payments).toHaveLength(0)
  })
})
