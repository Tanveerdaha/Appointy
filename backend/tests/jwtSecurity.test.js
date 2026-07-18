/**
 * JWT cryptographic separation + claim validation security tests.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals'
import request from 'supertest'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

let app
let User, Doctor
let generateAccessToken, getSecretForRole, JWT_ROLES, JWT_ISSUER, JWT_AUDIENCES, TOKEN_TYPE

const setJwtEnv = () => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test_jwt_secret'
  process.env.JWT_PATIENT_SECRET = 'test_patient_secret'
  process.env.JWT_DOCTOR_SECRET = 'test_doctor_secret'
  process.env.JWT_ADMIN_SECRET = 'test_admin_secret'
  process.env.ACCESS_TOKEN_EXPIRES = '15m'
  process.env.REFRESH_TOKEN_EXPIRES = '30d'
  process.env.JWT_ACCEPT_LEGACY = 'false'
  process.env.ADMIN_EMAIL = 'admin@test.com'
  process.env.ADMIN_PASSWORD = 'password123'
  process.env.DB_DIALECT = 'sqlite'
  process.env.SQLITE_STORAGE = ':memory:'
}

beforeAll(async () => {
  setJwtEnv()

  const { createApp, initServices } = await import('../app.js')
  User = (await import('../models/userModel.js')).default
  Doctor = (await import('../models/doctorModel.js')).default
  const jwtService = await import('../services/jwtService.js')
  generateAccessToken = jwtService.generateAccessToken
  getSecretForRole = jwtService.getSecretForRole
  JWT_ROLES = jwtService.JWT_ROLES
  JWT_ISSUER = jwtService.JWT_ISSUER
  JWT_AUDIENCES = jwtService.JWT_AUDIENCES
  TOKEN_TYPE = jwtService.TOKEN_TYPE

  await initServices()
  app = createApp()
})

afterAll(() => {
  // Avoid leaking JWT_ACCEPT_LEGACY=false into other suites under --runInBand
  process.env.JWT_ACCEPT_LEGACY = 'true'
})

beforeEach(async () => {
  const RefreshToken = (await import('../models/refreshTokenModel.js')).default
  await RefreshToken.destroy({ where: {}, truncate: true })
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
    name: 'Dr Secure',
    email,
    password: hashed,
    image: 'img.png',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: '5 Year',
    about: 'Security doctor',
    fees: 300,
    address: { line1: 'A', line2: 'B' },
    date: Date.now(),
    available: true,
    slots_booked: {},
  })
}

describe('JWT role / audience separation', () => {
  test('Test 1 — patient token cannot access doctor API', async () => {
    const user = await seedUser()
    const patientToken = generateAccessToken({ id: user.id, role: JWT_ROLES.PATIENT })

    const res = await request(app)
      .get('/api/doctor/appointments')
      .set('Authorization', `Bearer ${patientToken}`)

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  test('Test 2 — doctor token cannot access patient API', async () => {
    const doctor = await seedDoctor()
    const doctorToken = generateAccessToken({ id: doctor.id, role: JWT_ROLES.DOCTOR })

    const res = await request(app)
      .get('/api/user/get-profile')
      .set('Authorization', `Bearer ${doctorToken}`)

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  test('Test 3 — admin token is rejected by doctor API', async () => {
    const adminToken = generateAccessToken({
      id: process.env.ADMIN_EMAIL,
      role: JWT_ROLES.ADMIN,
      extra: { email: process.env.ADMIN_EMAIL },
    })

    const res = await request(app)
      .get('/api/doctor/appointments')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  test('Test 3b — admin token is accepted only on admin routes', async () => {
    const adminToken = generateAccessToken({
      id: process.env.ADMIN_EMAIL,
      role: JWT_ROLES.ADMIN,
      extra: { email: process.env.ADMIN_EMAIL },
    })

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('Test 4 — modified role claim with wrong signature is rejected', async () => {
    const user = await seedUser()
    const forged = jwt.sign(
      {
        role: JWT_ROLES.ADMIN,
        tokenType: TOKEN_TYPE.ACCESS,
        email: process.env.ADMIN_EMAIL,
      },
      'attacker-secret',
      {
        subject: user.id,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCES[JWT_ROLES.ADMIN],
        expiresIn: '15m',
      }
    )

    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${forged}`)

    expect(res.status).toBe(401)
  })

  test('Test 5 — expired token is rejected', async () => {
    const user = await seedUser()
    const expired = jwt.sign(
      { role: JWT_ROLES.PATIENT, tokenType: TOKEN_TYPE.ACCESS },
      getSecretForRole(JWT_ROLES.PATIENT),
      {
        subject: user.id,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCES[JWT_ROLES.PATIENT],
        expiresIn: -10,
      }
    )

    const res = await request(app)
      .get('/api/user/get-profile')
      .set('Authorization', `Bearer ${expired}`)

    expect(res.status).toBe(401)
  })

  test('Test 6 — wrong audience is rejected', async () => {
    const doctor = await seedDoctor()
    const wrongAud = jwt.sign(
      { role: JWT_ROLES.DOCTOR, tokenType: TOKEN_TYPE.ACCESS },
      getSecretForRole(JWT_ROLES.DOCTOR),
      {
        subject: doctor.id,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCES[JWT_ROLES.PATIENT],
        expiresIn: '15m',
      }
    )

    const res = await request(app)
      .get('/api/doctor/appointments')
      .set('Authorization', `Bearer ${wrongAud}`)

    expect(res.status).toBe(401)
  })

  test('Test 7 — wrong secret is rejected', async () => {
    const user = await seedUser()
    const wrongSecret = jwt.sign(
      { role: JWT_ROLES.PATIENT, tokenType: TOKEN_TYPE.ACCESS },
      'completely-wrong-secret',
      {
        subject: user.id,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCES[JWT_ROLES.PATIENT],
        expiresIn: '15m',
      }
    )

    const res = await request(app)
      .get('/api/user/get-profile')
      .set('Authorization', `Bearer ${wrongSecret}`)

    expect(res.status).toBe(401)
  })

  test('login issues patient-scoped claims and refresh cookie', async () => {
    const user = await seedUser('login_claims@test.com')
    const res = await request(app)
      .post('/api/user/login')
      .send({ email: user.email, password: 'password123' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.accessToken).toBe(res.body.token)
    expect(res.body.expiresIn).toBe('15m')

    const decoded = jwt.verify(res.body.token, process.env.JWT_PATIENT_SECRET)
    expect(decoded.role).toBe('patient')
    expect(decoded.tokenType).toBe('access')
    expect(decoded.iss).toBe(JWT_ISSUER)
    expect(decoded.aud).toBe(JWT_AUDIENCES[JWT_ROLES.PATIENT])
    expect(decoded.sub).toBe(user.id)

    const setCookie = res.headers['set-cookie'] || []
    expect(setCookie.some((c) => c.startsWith('appointy_patient_refresh='))).toBe(true)
    expect(setCookie.some((c) => /HttpOnly/i.test(c))).toBe(true)
  })

  test('refresh rotates access token using HttpOnly cookie', async () => {
    const user = await seedUser('refresh_flow@test.com')
    const login = await request(app)
      .post('/api/user/login')
      .send({ email: user.email, password: 'password123' })

    const cookies = login.headers['set-cookie']
    const refresh = await request(app)
      .post('/api/user/refresh')
      .set('Cookie', cookies)

    expect(refresh.status).toBe(200)
    expect(refresh.body.accessToken).toBeTruthy()

    const profile = await request(app)
      .get('/api/user/get-profile')
      .set('Authorization', `Bearer ${refresh.body.accessToken}`)

    expect(profile.status).toBe(200)
    expect(profile.body.userData.email).toBe(user.email)

    // Previous refresh cookie must be revoked after rotation
    const reuse = await request(app)
      .post('/api/user/refresh')
      .set('Cookie', cookies)
    expect(reuse.status).toBe(401)
  })

  test('logout revokes refresh token', async () => {
    const user = await seedUser('logout_flow@test.com')
    const login = await request(app)
      .post('/api/user/login')
      .send({ email: user.email, password: 'password123' })

    const cookies = login.headers['set-cookie']
    const logout = await request(app)
      .post('/api/user/logout')
      .set('Cookie', cookies)

    expect(logout.status).toBe(200)

    const refresh = await request(app)
      .post('/api/user/refresh')
      .set('Cookie', cookies)

    expect(refresh.status).toBe(401)
  })
})
