/**
 * Pricing integrity: fee validation, appointment amount snapshots,
 * Stripe amount verification, ownership checks, and audit history.
 */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals'
import request from 'supertest'
import bcrypt from 'bcrypt'

let app
let User, Doctor, Appointment, AppointmentHistory, DoctorPriceHistory
let validateDoctorFee, calculateAppointmentAmount, validateStripeAmount, PricingError
let generateAccessToken, JWT_ROLES

const FUTURE_START = '2030-07-22T10:00:00+05:00'
const FUTURE_START_B = '2030-07-22T10:30:00+05:00'

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
  process.env.CURRENCY = 'PKR'
  process.env.MIN_APPOINTMENT_FEE = '100'
  process.env.MAX_APPOINTMENT_FEE = '1000000'
  process.env.SCHEDULING_UTC_OFFSET_MINUTES = '300'
  process.env.STRIPE_SECRET_KEY = 'sk_test_pricing'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_pricing'

  const { createApp, initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  Appointment = (await import('../models/appointmentModel.js')).default
  AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default
  DoctorPriceHistory = (await import('../models/doctorPriceHistoryModel.js')).default
  const pricing = await import('../services/pricingService.js')
  validateDoctorFee = pricing.validateDoctorFee
  calculateAppointmentAmount = pricing.calculateAppointmentAmount
  validateStripeAmount = pricing.validateStripeAmount
  PricingError = pricing.PricingError
  const jwtService = await import('../services/jwtService.js')
  generateAccessToken = jwtService.generateAccessToken
  JWT_ROLES = jwtService.JWT_ROLES

  await initServices()
  app = createApp()
})

beforeEach(async () => {
  await AppointmentHistory.destroy({ where: {}, truncate: true })
  await DoctorPriceHistory.destroy({ where: {}, truncate: true })
  const RefundAudit = (await import('../models/refundAuditModel.js')).default
  const StripePayment = (await import('../models/stripePaymentModel.js')).default
  await RefundAudit.destroy({ where: {}, truncate: true })
  await StripePayment.destroy({ where: {}, truncate: true })
  await Appointment.destroy({ where: {}, truncate: true })
  await Doctor.destroy({ where: {}, truncate: true })
  await User.destroy({ where: {}, truncate: true })
})

const seedUser = async (email = `patient_${Date.now()}@test.com`) => {
  const hashed = await bcrypt.hash('password123', 10)
  return User.create({ name: 'Patient', email, password: hashed })
}

const seedDoctor = async ({
  email = `doc_${Date.now()}@test.com`,
  fees = 2000,
} = {}) => {
  const hashed = await bcrypt.hash('password123', 10)
  return Doctor.create({
    name: 'Dr Pricing',
    email,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Pricing doctor',
    fees,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    available: true,
    slots_booked: {},
  })
}

const doctorToken = (doctor) =>
  generateAccessToken({ id: doctor.id, role: JWT_ROLES.DOCTOR })

const patientToken = (user) =>
  generateAccessToken({ id: user.id, role: JWT_ROLES.PATIENT })

describe('pricingService unit rules', () => {
  test('accepts valid fees', () => {
    expect(validateDoctorFee(500).fee).toBe(500)
    expect(validateDoctorFee('500.00').fee).toBe(500)
    expect(validateDoctorFee(1500.5).fee).toBe(1500.5)
  })

  test('rejects negative, zero, non-numeric, huge, and non-finite fees', () => {
    for (const bad of [-500, 0, 'abc', 999999999999, NaN, Infinity, null, undefined, '']) {
      expect(() => validateDoctorFee(bad)).toThrow(PricingError)
    }
  })
})

describe('Doctor fee update validation', () => {
  test('Test 1 — negative fee returns 400', async () => {
    const doctor = await seedDoctor()
    const res = await request(app)
      .post('/api/doctor/update-profile')
      .set('Authorization', `Bearer ${doctorToken(doctor)}`)
      .send({ fees: -500 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/Invalid appointment fee/i)
    await doctor.reload()
    expect(Number(doctor.fees)).toBe(2000)
  })

  test('Test 2 — zero fee rejected', async () => {
    const doctor = await seedDoctor()
    const res = await request(app)
      .post('/api/doctor/update-profile')
      .set('Authorization', `Bearer ${doctorToken(doctor)}`)
      .send({ fees: 0 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('Test 3 — huge fee rejected', async () => {
    const doctor = await seedDoctor()
    const res = await request(app)
      .post('/api/doctor/update-profile')
      .set('Authorization', `Bearer ${doctorToken(doctor)}`)
      .send({ fees: 999999999999 })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('Test 4 — string injection rejected', async () => {
    const doctor = await seedDoctor()
    const res = await request(app)
      .post('/api/doctor/update-profile')
      .set('Authorization', `Bearer ${doctorToken(doctor)}`)
      .send({ fees: 'abc' })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('Test 7 — Doctor A cannot update Doctor B fee', async () => {
    const doctorA = await seedDoctor({ email: 'a@pricing.test', fees: 2000 })
    const doctorB = await seedDoctor({ email: 'b@pricing.test', fees: 2500 })

    const res = await request(app)
      .post('/api/doctor/update-profile')
      .set('Authorization', `Bearer ${doctorToken(doctorA)}`)
      .send({ fees: 3000, docId: doctorB.id })

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)

    await doctorB.reload()
    expect(Number(doctorB.fees)).toBe(2500)
  })

  test('valid fee update writes audit history', async () => {
    const doctor = await seedDoctor({ fees: 1000 })
    const res = await request(app)
      .post('/api/doctor/update-profile')
      .set('Authorization', `Bearer ${doctorToken(doctor)}`)
      .send({ fees: 1500 })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    await doctor.reload()
    expect(Number(doctor.fees)).toBe(1500)

    const history = await DoctorPriceHistory.findAll({ where: { doctorId: doctor.id } })
    expect(history).toHaveLength(1)
    expect(Number(history[0].oldFee)).toBe(1000)
    expect(Number(history[0].newFee)).toBe(1500)
    expect(history[0].changedByRole).toBe('doctor')
  })
})

describe('Appointment amount snapshot', () => {
  test('Test 5 — fee change after booking does not alter appointment amount', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor({ fees: 2000 })

    const book = await request(app)
      .post('/api/user/book-appointment')
      .set('Authorization', `Bearer ${patientToken(user)}`)
      .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

    expect(book.status).toBe(200)
    expect(book.body.success).toBe(true)
    expect(Number(book.body.appointment.amount)).toBe(2000)
    expect(book.body.appointment.currency).toBe('PKR')

    const appointmentId = book.body.appointment.id

    const update = await request(app)
      .post('/api/doctor/update-profile')
      .set('Authorization', `Bearer ${doctorToken(doctor)}`)
      .send({ fees: 3000 })

    expect(update.status).toBe(200)
    await doctor.reload()
    expect(Number(doctor.fees)).toBe(3000)

    const appointment = await Appointment.findByPk(appointmentId)
    expect(Number(appointment.amount)).toBe(2000)
    expect(appointment.currency).toBe('PKR')
  })

  test('booking ignores client-supplied amount', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor({ fees: 2000 })

    const book = await request(app)
      .post('/api/user/book-appointment')
      .set('Authorization', `Bearer ${patientToken(user)}`)
      .send({
        docId: doctor.id,
        startTime: FUTURE_START_B,
        payMode: 'later',
        amount: 1,
        fees: 1,
      })

    expect(book.status).toBe(200)
    expect(Number(book.body.appointment.amount)).toBe(2000)
  })

  test('calculateAppointmentAmount uses doctor fee only', () => {
    const result = calculateAppointmentAmount({ fees: 2000 })
    expect(result).toEqual({ amount: 2000, currency: 'PKR' })
  })
})

describe('Stripe amount verification', () => {
  test('Test 6 — amount mismatch is rejected and logged', () => {
    const result = validateStripeAmount({
      stripeAmountTotal: 500000,
      appointmentAmount: 2000,
      stripeCurrency: 'pkr',
      appointmentCurrency: 'PKR',
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('amount_mismatch')
  })

  test('matching Stripe amount succeeds', () => {
    const result = validateStripeAmount({
      stripeAmountTotal: 200000,
      appointmentAmount: 2000,
      stripeCurrency: 'pkr',
      appointmentCurrency: 'PKR',
    })

    expect(result.ok).toBe(true)
    expect(result.expectedCents).toBe(200000)
  })

  test('end-to-end: book at 2000, doctor raises fee, checkout uses snapshot', async () => {
    const user = await seedUser('snap@test.com')
    const doctor = await seedDoctor({ email: 'snapdoc@test.com', fees: 2000 })

    const book = await request(app)
      .post('/api/user/book-appointment')
      .set('Authorization', `Bearer ${patientToken(user)}`)
      .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

    const appointmentId = book.body.appointment.id

    await request(app)
      .post('/api/doctor/update-profile')
      .set('Authorization', `Bearer ${doctorToken(doctor)}`)
      .send({ fees: 5000 })

    const appointment = await Appointment.findByPk(appointmentId)
    expect(Number(appointment.amount)).toBe(2000)

    const { getExpectedAmountCents, validateStripePayment } = await import(
      '../services/stripePaymentService.js'
    )
    expect(getExpectedAmountCents(appointment)).toBe(200000)

    const ok = validateStripePayment(
      {
        id: 'cs_test',
        payment_status: 'paid',
        amount_total: 200000,
        currency: 'pkr',
        metadata: { appointmentId: appointment.id, userId: user.id },
      },
      appointment
    )
    expect(ok.ok).toBe(true)

    const mismatch = validateStripePayment(
      {
        id: 'cs_bad',
        payment_status: 'paid',
        amount_total: 500000,
        currency: 'pkr',
        metadata: { appointmentId: appointment.id, userId: user.id },
      },
      appointment
    )
    expect(mismatch.ok).toBe(false)
    expect(mismatch.code).toBe('amount_mismatch')
  })
})
