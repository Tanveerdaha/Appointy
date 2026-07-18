/**
 * Doctor soft-delete + referential integrity for admin delete-doctor.
 */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals'
import request from 'supertest'
import bcrypt from 'bcrypt'

let app
let User, Doctor, Appointment, AppointmentHistory, DoctorPriceHistory
let APPOINTMENT_STATUS
let generateAccessToken, JWT_ROLES

const FUTURE_START = '2030-08-15T10:00:00+05:00'

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
  process.env.SCHEDULING_TIMEZONE = 'Asia/Karachi'

  const { createApp, initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  const appointmentModel = await import('../models/appointmentModel.js')
  Appointment = appointmentModel.default
  APPOINTMENT_STATUS = appointmentModel.APPOINTMENT_STATUS
  AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default
  DoctorPriceHistory = (await import('../models/doctorPriceHistoryModel.js')).default
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
  await Doctor.destroy({ where: {}, truncate: true, force: true })
  await User.destroy({ where: {}, truncate: true })
})

const seedUser = async (email = `patient_${Date.now()}@test.com`) => {
  const hashed = await bcrypt.hash('password123', 10)
  return User.create({ name: 'Patient', email, password: hashed })
}

const seedDoctor = async ({
  email = `doc_${Date.now()}_${Math.random()}@test.com`,
  password = 'password123',
} = {}) => {
  const hashed = await bcrypt.hash(password, 10)
  return Doctor.create({
    name: 'Dr Delete',
    email,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Delete doctor',
    fees: 500,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    available: true,
    slots_booked: {},
  })
}

const seedAppointment = async ({
  doctor,
  user,
  status = APPOINTMENT_STATUS.COMPLETED,
  startTime = new Date(FUTURE_START),
} = {}) => {
  const held =
    status === APPOINTMENT_STATUS.CANCELLED || status === APPOINTMENT_STATUS.NO_SHOW
      ? null
      : startTime

  return Appointment.create({
    userId: user.id,
    docId: doctor.id,
    userData: { name: user.name, email: user.email },
    docData: { name: doctor.name, fees: doctor.fees },
    amount: 500,
    currency: 'PKR',
    startTime,
    heldStartTime: held,
    status,
    statusChangedAt: new Date(),
    slotDate: '15_8_2030',
    slotTime: '10:00 AM',
    date: Date.now(),
    payment: status === APPOINTMENT_STATUS.COMPLETED,
    paymentStatus: status === APPOINTMENT_STATUS.COMPLETED ? 'paid' : 'unpaid',
    cancelled: status === APPOINTMENT_STATUS.CANCELLED,
    isCompleted: status === APPOINTMENT_STATUS.COMPLETED,
  })
}

const adminToken = () =>
  generateAccessToken({
    id: process.env.ADMIN_EMAIL,
    role: JWT_ROLES.ADMIN,
    extra: { email: process.env.ADMIN_EMAIL },
  })

describe('admin delete-doctor soft-delete integrity', () => {
  test('soft-deletes doctor with COMPLETED history and hides from listings', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    await seedAppointment({ doctor, user, status: APPOINTMENT_STATUS.COMPLETED })

    const res = await request(app)
      .post('/api/admin/delete-doctor')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: doctor.id })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toBe('Doctor Removed')

    expect(await Doctor.findByPk(doctor.id)).toBeNull()

    const softDeleted = await Doctor.findByPk(doctor.id, { paranoid: false })
    expect(softDeleted).not.toBeNull()
    expect(softDeleted.deletedAt).not.toBeNull()
    expect(softDeleted.available).toBe(false)

    const listed = await Doctor.findAll()
    expect(listed.find((d) => d.id === doctor.id)).toBeUndefined()

    const appointment = await Appointment.findOne({ where: { docId: doctor.id } })
    expect(appointment).not.toBeNull()
    expect(appointment.status).toBe(APPOINTMENT_STATUS.COMPLETED)
  })

  test('soft-deletes doctor with CANCELLED history', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    await seedAppointment({ doctor, user, status: APPOINTMENT_STATUS.CANCELLED })

    const res = await request(app)
      .post('/api/admin/delete-doctor')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: doctor.id })

    expect(res.body.success).toBe(true)
    const softDeleted = await Doctor.findByPk(doctor.id, { paranoid: false })
    expect(softDeleted.deletedAt).not.toBeNull()
  })

  test('blocks delete when CONFIRMED appointment exists', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    await seedAppointment({ doctor, user, status: APPOINTMENT_STATUS.CONFIRMED })

    const res = await request(app)
      .post('/api/admin/delete-doctor')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: doctor.id })

    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/active appointments/i)
    expect(await Doctor.findByPk(doctor.id)).not.toBeNull()
  })

  test('blocks delete when PENDING_PAYMENT appointment exists', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    await seedAppointment({ doctor, user, status: APPOINTMENT_STATUS.PENDING_PAYMENT })

    const res = await request(app)
      .post('/api/admin/delete-doctor')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: doctor.id })

    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/active appointments/i)
  })

  test('hard-deletes doctor with zero appointments and no price history', async () => {
    const doctor = await seedDoctor()

    const res = await request(app)
      .post('/api/admin/delete-doctor')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: doctor.id })

    expect(res.body.success).toBe(true)
    expect(await Doctor.findByPk(doctor.id, { paranoid: false })).toBeNull()
  })

  test('soft-deletes when only price history exists', async () => {
    const doctor = await seedDoctor()
    await DoctorPriceHistory.create({
      doctorId: doctor.id,
      oldFee: 500,
      newFee: 600,
      changedBy: 'admin',
      changedByRole: 'admin',
    })

    const res = await request(app)
      .post('/api/admin/delete-doctor')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: doctor.id })

    expect(res.body.success).toBe(true)
    const softDeleted = await Doctor.findByPk(doctor.id, { paranoid: false })
    expect(softDeleted.deletedAt).not.toBeNull()
    expect(await DoctorPriceHistory.count({ where: { doctorId: doctor.id } })).toBe(1)
  })

  test('soft-deleted doctor cannot log in', async () => {
    const email = `softlogin_${Date.now()}@test.com`
    const password = 'password123'
    const user = await seedUser()
    const doctor = await seedDoctor({ email, password })
    await seedAppointment({ doctor, user, status: APPOINTMENT_STATUS.COMPLETED })

    await request(app)
      .post('/api/admin/delete-doctor')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: doctor.id })

    const login = await request(app)
      .post('/api/doctor/login')
      .send({ email, password })

    expect(login.status).toBe(401)
    expect(login.body.success).toBe(false)
  })

  test('returns 404 for unknown doctor', async () => {
    const res = await request(app)
      .post('/api/admin/delete-doctor')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: '00000000-0000-4000-8000-000000000099' })

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
  })

  test('force hard-delete with dependents is rejected by RESTRICT association', async () => {
    const user = await seedUser()
    const doctor = await seedDoctor()
    await seedAppointment({ doctor, user, status: APPOINTMENT_STATUS.COMPLETED })

    await expect(doctor.destroy({ force: true })).rejects.toThrow()

    expect(await Doctor.findByPk(doctor.id)).not.toBeNull()
    expect(await Appointment.count({ where: { docId: doctor.id } })).toBe(1)
  })
})
