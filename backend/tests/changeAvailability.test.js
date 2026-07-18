/**
 * Admin vs doctor change-availability identity separation.
 */
import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals'
import request from 'supertest'
import bcrypt from 'bcrypt'

let app
let Doctor
let generateAccessToken, JWT_ROLES

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

  const { createApp, initServices } = await import('../app.js')
  Doctor = (await import('../models/doctorModel.js')).default
  const jwtService = await import('../services/jwtService.js')
  generateAccessToken = jwtService.generateAccessToken
  JWT_ROLES = jwtService.JWT_ROLES

  await initServices()
  app = createApp()
})

beforeEach(async () => {
  await Doctor.destroy({ where: {}, truncate: true })
})

const seedDoctor = async ({
  email = `doc_${Date.now()}_${Math.random()}@test.com`,
  available = true,
} = {}) => {
  const hashed = await bcrypt.hash('password123', 10)
  return Doctor.create({
    name: 'Dr Availability',
    email,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Availability doctor',
    fees: 500,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    available,
    slots_booked: {},
  })
}

const doctorToken = (doctor) =>
  generateAccessToken({ id: doctor.id, role: JWT_ROLES.DOCTOR })

const adminToken = () =>
  generateAccessToken({
    id: process.env.ADMIN_EMAIL,
    role: JWT_ROLES.ADMIN,
    extra: { email: process.env.ADMIN_EMAIL },
  })

describe('change availability identity separation', () => {
  test('admin with valid docId toggles doctor availability', async () => {
    const doctor = await seedDoctor({ available: true })

    const res = await request(app)
      .post('/api/admin/change-availability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ docId: doctor.id })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    await doctor.reload()
    expect(doctor.available).toBe(false)
  })

  test('admin without docId returns 400', async () => {
    await seedDoctor()

    const res = await request(app)
      .post('/api/admin/change-availability')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  test('doctor toggles own availability', async () => {
    const doctor = await seedDoctor({ available: true })

    const res = await request(app)
      .post('/api/doctor/change-availability')
      .set('Authorization', `Bearer ${doctorToken(doctor)}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    await doctor.reload()
    expect(doctor.available).toBe(false)
  })

  test('doctor cannot toggle another doctor via spoofed docId', async () => {
    const doctorA = await seedDoctor({ email: 'a@avail.test', available: true })
    const doctorB = await seedDoctor({ email: 'b@avail.test', available: true })

    const res = await request(app)
      .post('/api/doctor/change-availability')
      .set('Authorization', `Bearer ${doctorToken(doctorA)}`)
      .send({ docId: doctorB.id })

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)

    await doctorB.reload()
    expect(doctorB.available).toBe(true)
  })
})
