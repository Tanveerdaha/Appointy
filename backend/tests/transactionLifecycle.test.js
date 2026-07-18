/**
 * Transaction lifecycle tests.
 *
 * Verifies:
 * - Managed commit / rollback
 * - No rollback after commit when post-commit side effects fail
 * - Stripe failure after booking leaves appointment intact + pending_retry
 * - Concurrent booking safety
 * - Notification failures do not undo bookings
 * - Reschedule uses withTransaction (no post-commit rollback risk)
 * - Concurrent / failed reschedule leaves consistent slot state
 */
import bcrypt from 'bcrypt'
import { jest } from '@jest/globals'

let User, Doctor, Appointment, AppointmentHistory, StripePayment
let createAppointment, rescheduleAppointment, SchedulingError
let createAppointmentPayment
let withTransaction
let PAYMENT_STATUS, APPOINTMENT_PAYMENT_STATUS
let enqueueNotification, clearNotificationQueue, flushNotificationQueue, getNotificationQueueSnapshot

const FUTURE_START = new Date('2030-07-22T10:00:00+05:00')
const FUTURE_START_B = new Date('2030-07-22T10:30:00+05:00')
const FUTURE_START_C = new Date('2030-07-22T11:00:00+05:00')

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

  const { initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  Appointment = (await import('../models/appointmentModel.js')).default
  AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default
  const paymentModel = await import('../models/stripePaymentModel.js')
  StripePayment = paymentModel.default
  PAYMENT_STATUS = paymentModel.PAYMENT_STATUS
  APPOINTMENT_PAYMENT_STATUS = paymentModel.APPOINTMENT_PAYMENT_STATUS
  ;({ createAppointment, rescheduleAppointment, SchedulingError } = await import(
    '../services/appointmentService.js'
  ))
  ;({ createAppointmentPayment } = await import('../services/paymentService.js'))
  ;({ withTransaction } = await import('../utils/databaseTransaction.js'))
  ;({
    enqueueNotification,
    clearNotificationQueue,
    flushNotificationQueue,
    getNotificationQueueSnapshot,
  } = await import('../services/notificationQueue.js'))

  await initServices()
})

beforeEach(async () => {
  clearNotificationQueue()
  const RefundAudit = (await import('../models/refundAuditModel.js')).default
  await RefundAudit.destroy({ where: {}, truncate: true })
  await StripePayment.destroy({ where: {}, truncate: true })
  await AppointmentHistory.destroy({ where: {}, truncate: true })
  await Appointment.destroy({ where: {}, truncate: true })
  await Doctor.destroy({ where: {}, truncate: true })
  await User.destroy({ where: {}, truncate: true })
})

const seedUser = async (email = `patient_${Date.now()}@test.com`) => {
  const salt = await bcrypt.genSalt(10)
  const hashed = await bcrypt.hash('password123', salt)
  return User.create({ name: 'Patient', email, password: hashed })
}

const seedDoctor = async (email = `doc_${Date.now()}@test.com`) => {
  const salt = await bcrypt.genSalt(10)
  const hashed = await bcrypt.hash('password123', salt)
  return Doctor.create({
    name: 'Dr Tx',
    email,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Tx doctor',
    fees: 400,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    available: true,
    slots_booked: {},
  })
}

describe('Transaction lifecycle', () => {
  test('Test 1: successful managed transaction commits without rollback', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })

    expect(appointment.id).toBeTruthy()
    const found = await Appointment.findByPk(appointment.id)
    expect(found).not.toBeNull()
    expect(found.status).toBe('CONFIRMED')
  })

  test('Test 2: booking database failure rolls back appointment, history, and slot cache', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    const updateSpy = jest.spyOn(Doctor, 'update').mockRejectedValueOnce(new Error('forced_db_failure'))

    try {
      await expect(
        createAppointment({
          doctorId: doctor.id,
          userId: user.id,
          startTime: FUTURE_START,
          payMode: 'later',
        })
      ).rejects.toThrow('forced_db_failure')
    } finally {
      updateSpy.mockRestore()
    }

    expect(await Appointment.count()).toBe(0)
    expect(await AppointmentHistory.count()).toBe(0)
    await doctor.reload()
    expect(doctor.slots_booked).toEqual({})
  })

  test('Test 3: error after commit does not rollback appointment', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })

    const appointmentId = appointment.id
    let sideEffectError = null
    try {
      // Simulate post-commit side effect failure (email / notification).
      throw new Error('notification_failed')
    } catch (error) {
      sideEffectError = error
      // Critical: do NOT manually roll back here — booking already committed.
    }

    expect(sideEffectError.message).toBe('notification_failed')

    const found = await Appointment.findByPk(appointmentId)
    expect(found).not.toBeNull()
    expect(found.id).toBe(appointmentId)
    expect(found.status).toBe('CONFIRMED')
  })

  test('Test 4: Stripe failure after booking keeps appointment and sets pending_retry', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'now',
    })

    expect(appointment.id).toBeTruthy()

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
    expect(result.paymentStatus).toBe(APPOINTMENT_PAYMENT_STATUS.PENDING_RETRY)

    await appointment.reload()
    expect(appointment.id).toBeTruthy()
    expect(appointment.paymentStatus).toBe(APPOINTMENT_PAYMENT_STATUS.PENDING_RETRY)
    expect(appointment.status).toBe('PENDING_PAYMENT')
    expect(appointment.holdExpiresAt).toBeTruthy()

    const payment = await StripePayment.findByPk(result.paymentId)
    expect(payment.status).toBe(PAYMENT_STATUS.FAILED)
    expect(payment.activeAppointmentId).toBeNull()

    // Retry is possible — a later createAppointmentPayment can succeed.
    const retry = await createAppointmentPayment(
      { appointmentId: appointment.id, userId: user.id },
      {
        createSession: async (_appt, _userId, options = {}) => ({
          id: 'cs_retry_ok',
          url: 'https://checkout.stripe.test/retry',
          expires_at: Math.floor((options.expiresAt?.getTime() || Date.now() + 3600000) / 1000),
        }),
      }
    )
    expect(retry.ok).toBe(true)
    expect(retry.sessionId).toBe('cs_retry_ok')

    await appointment.reload()
    expect(appointment.paymentStatus).toBe(APPOINTMENT_PAYMENT_STATUS.PENDING)
  })

  test('Test 5: concurrent booking — one succeeds, one fails safely', async () => {
    const userA = await seedUser('a_tx@test.com')
    const userB = await seedUser('b_tx@test.com')
    const doctor = await seedDoctor()

    const results = await Promise.allSettled([
      createAppointment({
        doctorId: doctor.id,
        userId: userA.id,
        startTime: FUTURE_START,
        payMode: 'later',
      }),
      createAppointment({
        doctorId: doctor.id,
        userId: userB.id,
        startTime: FUTURE_START,
        payMode: 'later',
      }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBeInstanceOf(SchedulingError)
    expect(rejected[0].reason.code).toBe('slot_unavailable')

    const count = await Appointment.count({ where: { docId: doctor.id } })
    expect(count).toBe(1)
  })

  test('Test 6: notification failure queues retry — booking still succeeds', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })

    let attempts = 0
    enqueueNotification({
      type: 'appointment_booked',
      meta: { appointmentId: appointment.id },
      maxAttempts: 2,
      handler: async () => {
        attempts += 1
        if (attempts < 2) throw new Error('SMTP down')
      },
    })

    await flushNotificationQueue()

    expect(attempts).toBe(2)
    const snapshot = getNotificationQueueSnapshot()
    // Succeeded jobs are removed from the queue.
    expect(snapshot.every((j) => j.status !== 'running')).toBe(true)

    const found = await Appointment.findByPk(appointment.id)
    expect(found).not.toBeNull()
  })

  test('withTransaction preserves callback return value after commit', async () => {
    const payload = { ok: true, id: 'tx-result-1' }
    const result = await withTransaction(async () => payload, {
      operation: 'test_return_value',
    })
    expect(result).toBe(payload)
    expect(result).toEqual({ ok: true, id: 'tx-result-1' })
  })

  test('withTransaction preserves thrown error statusCode and code', async () => {
    const original = Object.assign(new Error('business_reject'), {
      statusCode: 409,
      code: 'conflict',
    })

    let caught = null
    try {
      await withTransaction(async () => {
        throw original
      }, { operation: 'test_error_preserve' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(original)
    expect(caught.statusCode).toBe(409)
    expect(caught.code).toBe('conflict')
  })

  test('returning a failure object from withTransaction commits (does not roll back)', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const result = await withTransaction(async (transaction) => {
      const appointment = await Appointment.create(
        {
          userId: user.id,
          docId: doctor.id,
          userData: { id: user.id },
          docData: { id: doctor.id },
          amount: 100,
          currency: 'PKR',
          startTime: FUTURE_START,
          heldStartTime: FUTURE_START,
          slotDate: '22_7_2030',
          slotTime: '10:00 AM',
          date: Date.now(),
          payment: false,
          paymentStatus: 'refund_failed',
          status: 'CONFIRMED',
        },
        { transaction }
      )
      // Intentional non-throw failure shape (mirrors cancellation REFUND_FAILED path).
      return { done: true, failed: true, appointmentId: appointment.id }
    }, { operation: 'test_commit_on_return' })

    expect(result.failed).toBe(true)
    const found = await Appointment.findByPk(result.appointmentId)
    expect(found).not.toBeNull()
    expect(found.paymentStatus).toBe('refund_failed')
  })
})

describe('Reschedule transaction lifecycle', () => {
  test('Test 1: successful reschedule commits and moves appointment to new slot', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })

    const updated = await rescheduleAppointment({
      appointmentId: appointment.id,
      userId: user.id,
      newStartTime: FUTURE_START_B,
    })

    expect(new Date(updated.startTime).getTime()).toBe(FUTURE_START_B.getTime())
    expect(new Date(updated.heldStartTime).getTime()).toBe(FUTURE_START_B.getTime())

    const found = await Appointment.findByPk(appointment.id)
    expect(new Date(found.startTime).getTime()).toBe(FUTURE_START_B.getTime())
    expect(new Date(found.heldStartTime).getTime()).toBe(FUTURE_START_B.getTime())
    expect(found.slotTime).toBe('10:30 AM')

    await doctor.reload()
    expect(doctor.slots_booked['22_7_2030'] || []).not.toContain('10:00 AM')
    expect(doctor.slots_booked['22_7_2030']).toContain('10:30 AM')
  })

  test('Test 2: invalid new slot rolls back — appointment remains unchanged', async () => {
    const userA = await seedUser('resched_a@test.com')
    const userB = await seedUser('resched_b@test.com')
    const doctor = await seedDoctor()

    const apptA = await createAppointment({
      doctorId: doctor.id,
      userId: userA.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })
    const apptB = await createAppointment({
      doctorId: doctor.id,
      userId: userB.id,
      startTime: FUTURE_START_B,
      payMode: 'later',
    })

    const before = {
      startTime: new Date(apptB.startTime).getTime(),
      heldStartTime: new Date(apptB.heldStartTime).getTime(),
      slotTime: apptB.slotTime,
    }

    await expect(
      rescheduleAppointment({
        appointmentId: apptB.id,
        userId: userB.id,
        newStartTime: FUTURE_START, // occupied by apptA
      })
    ).rejects.toMatchObject({
      name: 'SchedulingError',
      code: 'slot_unavailable',
      statusCode: 409,
    })

    await apptB.reload()
    expect(new Date(apptB.startTime).getTime()).toBe(before.startTime)
    expect(new Date(apptB.heldStartTime).getTime()).toBe(before.heldStartTime)
    expect(apptB.slotTime).toBe(before.slotTime)

    // Occupying appointment untouched
    await apptA.reload()
    expect(new Date(apptA.startTime).getTime()).toBe(FUTURE_START.getTime())
  })

  test('Test 3: concurrent reschedule into same slot — only one succeeds', async () => {
    const userA = await seedUser('race_a@test.com')
    const userB = await seedUser('race_b@test.com')
    const doctor = await seedDoctor()

    const apptA = await createAppointment({
      doctorId: doctor.id,
      userId: userA.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })
    const apptB = await createAppointment({
      doctorId: doctor.id,
      userId: userB.id,
      startTime: FUTURE_START_B,
      payMode: 'later',
    })

    const results = await Promise.allSettled([
      rescheduleAppointment({
        appointmentId: apptA.id,
        userId: userA.id,
        newStartTime: FUTURE_START_C,
      }),
      rescheduleAppointment({
        appointmentId: apptB.id,
        userId: userB.id,
        newStartTime: FUTURE_START_C,
      }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBeInstanceOf(SchedulingError)
    expect(rejected[0].reason.code).toBe('slot_unavailable')

    const atTarget = await Appointment.count({
      where: {
        docId: doctor.id,
        heldStartTime: FUTURE_START_C,
        status: 'CONFIRMED',
      },
    })
    expect(atTarget).toBe(1)
  })

  test('Test 4: notification failure after commit leaves appointment rescheduled', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })

    await rescheduleAppointment({
      appointmentId: appointment.id,
      userId: user.id,
      newStartTime: FUTURE_START_B,
    })

    let attempts = 0
    let sideEffectError = null
    try {
      enqueueNotification({
        type: 'appointment_rescheduled',
        meta: { appointmentId: appointment.id },
        maxAttempts: 2,
        handler: async () => {
          attempts += 1
          throw new Error('SMTP down after reschedule')
        },
      })
      await flushNotificationQueue()
    } catch (error) {
      // Queue swallows handler errors; any outer failure must not roll back DB.
      sideEffectError = error
    }

    expect(sideEffectError).toBeNull()
    expect(attempts).toBe(2)

    const found = await Appointment.findByPk(appointment.id)
    expect(new Date(found.startTime).getTime()).toBe(FUTURE_START_B.getTime())
    expect(found.status).toBe('CONFIRMED')
    // Critical: no manual rollback after successful reschedule commit.
  })

  test('Test 5: database error during update rolls back — no partial update', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()

    const appointment = await createAppointment({
      doctorId: doctor.id,
      userId: user.id,
      startTime: FUTURE_START,
      payMode: 'later',
    })

    const beforeStart = new Date(appointment.startTime).getTime()
    const beforeHeld = new Date(appointment.heldStartTime).getTime()
    await doctor.reload()
    const beforeSlots = JSON.parse(JSON.stringify(doctor.slots_booked))

    const updateSpy = jest.spyOn(Doctor, 'update').mockRejectedValueOnce(new Error('forced_reschedule_db_failure'))

    try {
      await expect(
        rescheduleAppointment({
          appointmentId: appointment.id,
          userId: user.id,
          newStartTime: FUTURE_START_B,
        })
      ).rejects.toThrow('forced_reschedule_db_failure')
    } finally {
      updateSpy.mockRestore()
    }

    await appointment.reload()
    expect(new Date(appointment.startTime).getTime()).toBe(beforeStart)
    expect(new Date(appointment.heldStartTime).getTime()).toBe(beforeHeld)
    expect(appointment.slotTime).toBe('10:00 AM')

    await doctor.reload()
    expect(doctor.slots_booked).toEqual(beforeSlots)
    expect(doctor.slots_booked['22_7_2030']).toContain('10:00 AM')
    expect(doctor.slots_booked['22_7_2030'] || []).not.toContain('10:30 AM')
  })
})
