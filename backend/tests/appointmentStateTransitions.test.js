/**
 * Appointment lifecycle state machine tests.
 */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals'
import request from 'supertest'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

let app
let User, Doctor, Appointment, AppointmentHistory
let canTransition, transitionAppointment, completeAppointment, cancelAppointment
let APPOINTMENT_STATUS, ACTOR_TYPE, HISTORY_OUTCOME, LifecycleError, TRANSITIONS

const FUTURE_START = '2030-08-12T10:00:00+05:00'

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test_jwt_secret'
  process.env.ADMIN_EMAIL = 'admin@test.com'
  process.env.ADMIN_PASSWORD = 'password123'
  process.env.DB_DIALECT = 'sqlite'
  process.env.SQLITE_STORAGE = ':memory:'
  process.env.SCHEDULING_UTC_OFFSET_MINUTES = '300'

  const { createApp, initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  Appointment = (await import('../models/appointmentModel.js')).default
  AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default

  const state = await import('../services/appointmentStateService.js')
  canTransition = state.canTransition
  transitionAppointment = state.transitionAppointment
  completeAppointment = state.completeAppointment
  cancelAppointment = state.cancelAppointment
  APPOINTMENT_STATUS = state.APPOINTMENT_STATUS
  ACTOR_TYPE = state.ACTOR_TYPE
  HISTORY_OUTCOME = state.HISTORY_OUTCOME
  LifecycleError = state.LifecycleError
  TRANSITIONS = state.TRANSITIONS

  await initServices()
  app = createApp()
})

beforeEach(async () => {
  await AppointmentHistory.destroy({ where: {}, truncate: true })
  await Appointment.destroy({ where: {}, truncate: true })
  await Doctor.destroy({ where: {}, truncate: true })
  await User.destroy({ where: {}, truncate: true })
})

const seedUser = async (email = `patient_${Date.now()}@test.com`) => {
  const hashed = await bcrypt.hash('password123', 10)
  return User.create({ name: 'Patient', email, password: hashed })
}

const seedDoctor = async (email = `doc_${Date.now()}@test.com`) => {
  const hashed = await bcrypt.hash('password123', 10)
  return Doctor.create({
    name: 'Dr Life',
    email,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Lifecycle doctor',
    fees: 400,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    available: true,
    slots_booked: {},
  })
}

const seedConfirmedAppointment = async ({ user, doctor, status = APPOINTMENT_STATUS.CONFIRMED } = {}) => {
  const u = user || (await seedUser())
  const d = doctor || (await seedDoctor())
  const startTime = new Date('2030-08-12T05:00:00.000Z')
  return Appointment.create({
    userId: u.id,
    docId: d.id,
    userData: { id: u.id, name: u.name, email: u.email },
    docData: { id: d.id, name: d.name, fees: d.fees, address: d.address, image: d.image, speciality: d.speciality },
    amount: d.fees,
    slotDate: '12_8_2030',
    slotTime: '10:00 AM',
    startTime,
    heldStartTime: status === APPOINTMENT_STATUS.CANCELLED || status === APPOINTMENT_STATUS.NO_SHOW ? null : startTime,
    status,
    statusChangedAt: new Date(),
    date: Date.now(),
    payment: false,
    paymentStatus: 'unpaid',
    cancelled: status === APPOINTMENT_STATUS.CANCELLED,
    isCompleted: status === APPOINTMENT_STATUS.COMPLETED,
    completedAt: status === APPOINTMENT_STATUS.COMPLETED ? new Date() : null,
    cancelledAt: status === APPOINTMENT_STATUS.CANCELLED ? new Date() : null,
  })
}

const loginUser = async (email) => {
  const res = await request(app).post('/api/user/login').send({ email, password: 'password123' })
  return res.body.token
}

const loginDoctor = async (email) => {
  const res = await request(app).post('/api/doctor/login').send({ email, password: 'password123' })
  return res.body.token
}

const adminToken = () =>
  jwt.sign({ role: 'admin', email: process.env.ADMIN_EMAIL }, process.env.JWT_SECRET, { expiresIn: '1h' })

describe('canTransition matrix', () => {
  test('allows documented transitions only', () => {
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED')).toBe(true)
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED')).toBe(true)
    expect(canTransition('CONFIRMED', 'COMPLETED')).toBe(true)
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true)
    expect(canTransition('CONFIRMED', 'NO_SHOW')).toBe(true)
  })

  test('rejects illegal transitions', () => {
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false)
    expect(canTransition('CANCELLED', 'COMPLETED')).toBe(false)
    expect(canTransition('COMPLETED', 'CONFIRMED')).toBe(false)
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false)
    expect(canTransition('NO_SHOW', 'CONFIRMED')).toBe(false)
    expect(canTransition('CONFIRMED', 'PENDING_PAYMENT')).toBe(false)
  })

  test('terminal states have empty transition lists', () => {
    expect(TRANSITIONS.COMPLETED).toEqual([])
    expect(TRANSITIONS.CANCELLED).toEqual([])
    expect(TRANSITIONS.NO_SHOW).toEqual([])
  })
})

describe('transitionAppointment', () => {
  test('Test 1 — complete CONFIRMED appointment', async () => {
    const doctor = await seedDoctor()
    const appointment = await seedConfirmedAppointment({ doctor })

    const updated = await completeAppointment(appointment.id, {
      actorType: ACTOR_TYPE.DOCTOR,
      actorId: doctor.id,
      reason: 'Completed by doctor',
    })

    expect(updated.status).toBe(APPOINTMENT_STATUS.COMPLETED)
    expect(updated.isCompleted).toBe(true)
    expect(updated.cancelled).toBe(false)
    expect(updated.completedAt).toBeTruthy()
    expect(updated.heldStartTime).toBeTruthy()

    const history = await AppointmentHistory.findAll({
      where: { appointmentId: appointment.id },
      order: [['createdAt', 'ASC']],
    })
    expect(history.some((h) => h.outcome === HISTORY_OUTCOME.SUCCEEDED && h.newStatus === 'COMPLETED')).toBe(true)
  })

  test('Test 2 — cancel COMPLETED appointment is rejected and audited', async () => {
    const appointment = await seedConfirmedAppointment({ status: APPOINTMENT_STATUS.COMPLETED })

    await expect(
      cancelAppointment(appointment.id, {
        actorType: ACTOR_TYPE.ADMIN,
        reason: 'Attempted cancel',
      })
    ).rejects.toMatchObject({
      name: 'LifecycleError',
      message: 'Completed appointments cannot be cancelled',
      code: 'cannot_cancel_completed',
    })

    await appointment.reload()
    expect(appointment.status).toBe(APPOINTMENT_STATUS.COMPLETED)
    expect(appointment.cancelled).toBe(false)
    expect(appointment.isCompleted).toBe(true)

    const rejected = await AppointmentHistory.findOne({
      where: {
        appointmentId: appointment.id,
        outcome: HISTORY_OUTCOME.REJECTED,
      },
    })
    expect(rejected).toBeTruthy()
    expect(rejected.oldStatus).toBe('COMPLETED')
    expect(rejected.newStatus).toBe('COMPLETED')
    expect(rejected.metadata?.requestedStatus).toBe('CANCELLED')
  })

  test('Test 3 — complete CANCELLED appointment is rejected', async () => {
    const appointment = await seedConfirmedAppointment({ status: APPOINTMENT_STATUS.CANCELLED })

    await expect(
      completeAppointment(appointment.id, {
        actorType: ACTOR_TYPE.DOCTOR,
      })
    ).rejects.toBeInstanceOf(LifecycleError)

    await appointment.reload()
    expect(appointment.status).toBe(APPOINTMENT_STATUS.CANCELLED)
    expect(appointment.isCompleted).toBe(false)
  })

  test('cancel releases heldStartTime and syncs booleans', async () => {
    const appointment = await seedConfirmedAppointment()
    await cancelAppointment(appointment.id, { actorType: ACTOR_TYPE.USER, actorId: appointment.userId })
    await appointment.reload()
    expect(appointment.status).toBe('CANCELLED')
    expect(appointment.cancelled).toBe(true)
    expect(appointment.isCompleted).toBe(false)
    expect(appointment.heldStartTime).toBeNull()
    expect(appointment.cancelledAt).toBeTruthy()
  })

  test('payment fields remain unchanged on complete', async () => {
    const appointment = await seedConfirmedAppointment()
    await appointment.update({ payment: true, paymentStatus: 'paid' })
    await completeAppointment(appointment.id, { actorType: ACTOR_TYPE.DOCTOR })
    await appointment.reload()
    expect(appointment.status).toBe('COMPLETED')
    expect(appointment.paymentStatus).toBe('paid')
    expect(appointment.payment).toBe(true)
  })
})

describe('HTTP lifecycle endpoints', () => {
  test('doctor completes then admin cancel is rejected', async () => {
    const user = await seedUser('life_user@test.com')
    const doctor = await seedDoctor('life_doc@test.com')
    const userToken = await loginUser(user.email)

    const book = await request(app)
      .post('/api/user/book-appointment')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

    expect(book.body.success).toBe(true)
    expect(book.body.appointment.status).toBe('CONFIRMED')
    const appointmentId = book.body.appointment.id

    const docToken = await loginDoctor(doctor.email)
    const complete = await request(app)
      .post('/api/doctor/complete-appointment')
      .set('Authorization', `Bearer ${docToken}`)
      .send({ appointmentId })

    expect(complete.status).toBe(200)
    expect(complete.body.success).toBe(true)

    const cancel = await request(app)
      .post('/api/admin/cancel-appointment')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ appointmentId })

    expect(cancel.status).toBe(400)
    expect(cancel.body.success).toBe(false)
    expect(cancel.body.message).toBe('Completed appointments cannot be cancelled')

    const appointment = await Appointment.findByPk(appointmentId)
    expect(appointment.status).toBe('COMPLETED')
    expect(appointment.cancelled).toBe(false)
    expect(appointment.isCompleted).toBe(true)

    const rejected = await AppointmentHistory.findOne({
      where: { appointmentId, outcome: 'REJECTED' },
    })
    expect(rejected).toBeTruthy()
  })

  test('Test 4 — reschedule COMPLETED appointment is rejected', async () => {
    const user = await seedUser('resched_user@test.com')
    const doctor = await seedDoctor('resched_doc@test.com')
    const userToken = await loginUser(user.email)

    const book = await request(app)
      .post('/api/user/book-appointment')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

    const appointmentId = book.body.appointment.id
    await completeAppointment(appointmentId, { actorType: ACTOR_TYPE.DOCTOR, actorId: doctor.id })

    const reschedule = await request(app)
      .post('/api/user/reschedule-appointment')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ appointmentId, newStartTime: '2030-08-12T10:30:00+05:00' })

    expect(reschedule.status).toBe(400)
    expect(reschedule.body.code).toBe('not_reschedulable')
  })

  test('PENDING_PAYMENT cannot be rescheduled', async () => {
    const user = await seedUser('pending_user@test.com')
    const doctor = await seedDoctor('pending_doc@test.com')
    const userToken = await loginUser(user.email)

    // Avoid Stripe by creating appointment row directly as PENDING_PAYMENT
    const appointment = await seedConfirmedAppointment({
      user,
      doctor,
      status: APPOINTMENT_STATUS.PENDING_PAYMENT,
    })

    const reschedule = await request(app)
      .post('/api/user/reschedule-appointment')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ appointmentId: appointment.id, newStartTime: '2030-08-12T10:30:00+05:00' })

    expect(reschedule.status).toBe(400)
    expect(reschedule.body.code).toBe('not_reschedulable')
  })
})

describe('Concurrent transitions', () => {
  test('Test 6 — complete and cancel race: only one succeeds', async () => {
    const appointment = await seedConfirmedAppointment()

    const results = await Promise.allSettled([
      completeAppointment(appointment.id, { actorType: ACTOR_TYPE.DOCTOR }),
      cancelAppointment(appointment.id, { actorType: ACTOR_TYPE.ADMIN }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(LifecycleError)

    await appointment.reload()
    expect(['COMPLETED', 'CANCELLED']).toContain(appointment.status)
    if (appointment.status === 'COMPLETED') {
      expect(appointment.cancelled).toBe(false)
      expect(appointment.isCompleted).toBe(true)
    } else {
      expect(appointment.cancelled).toBe(true)
      expect(appointment.isCompleted).toBe(false)
    }
  })
})
