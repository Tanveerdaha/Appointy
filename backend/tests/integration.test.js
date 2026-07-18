/**
 * Integration tests — require a working SQLite driver.
 * Run via: npm run test:integration
 * CI runs both unit and integration tests.
 */
import request from 'supertest'
import bcrypt from 'bcrypt'

let app
let User, Doctor, Appointment, AppointmentHistory

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
    User = (await import('../models/userModel.js')).default
    Doctor = (await import('../models/doctorModel.js')).default
    Appointment = (await import('../models/appointmentModel.js')).default
    AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default

    await initServices()
    app = createApp()
})

beforeEach(async () => {
    await AppointmentHistory.destroy({ where: {}, truncate: true })
    await Appointment.destroy({ where: {}, truncate: true })
    await Doctor.destroy({ where: {}, truncate: true })
    await User.destroy({ where: {}, truncate: true })
})

describe('Health', () => {
    test('GET /api/health returns healthy', async () => {
        const res = await request(app).get('/api/health')
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })
})

describe('User auth', () => {
    test('POST /api/user/register creates user', async () => {
        const res = await request(app)
            .post('/api/user/register')
            .send({ name: 'Test User', email: 'test@example.com', password: 'password123' })
        expect(res.status).toBe(200)
        expect(res.body.token).toBeDefined()
    })

    test('POST /api/user/login rejects invalid credentials', async () => {
        const res = await request(app)
            .post('/api/user/login')
            .send({ email: 'nouser@example.com', password: 'wrongpass' })
        expect(res.status).toBe(404)
    })
})

describe('Appointments', () => {
    test('POST /api/user/book-appointment books slot', async () => {
        const salt = await bcrypt.genSalt(10)
        const hashed = await bcrypt.hash('password123', salt)
        await User.create({ name: 'Patient', email: 'patient@test.com', password: hashed })
        const doctor = await Doctor.create({
            name: 'Dr Book', email: 'book@test.com', password: hashed, image: 'img.png',
            speciality: 'General physician', degree: 'MBBS', experience: '5 Year',
            about: 'Book doctor', fees: 300, address: { line1: 'A', line2: 'B' },
            date: Date.now(), slots_booked: {},
        })

        const loginRes = await request(app).post('/api/user/login').send({ email: 'patient@test.com', password: 'password123' })
        const res = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${loginRes.body.token}`)
            .send({
                docId: doctor.id,
                startTime: '2030-07-15T10:00:00+05:00',
                payMode: 'later',
            })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.appointment.startTime).toBeDefined()
        expect(res.body.appointment.status).toBe('CONFIRMED')
    })
})

describe('404', () => {
    test('unknown route returns 404', async () => {
        const res = await request(app).get('/api/unknown-route')
        expect(res.status).toBe(404)
    })
})
