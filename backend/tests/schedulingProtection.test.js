/**
 * Scheduling double-booking protection tests.
 * Covers concurrency, validation, cancel-rebook, and reschedule conflicts.
 */
import request from 'supertest'
import bcrypt from 'bcrypt'

let app
let User, Doctor, Appointment, AppointmentHistory

/** Future weekday 10:00 in clinic TZ (+05:00). */
const FUTURE_START = '2030-07-22T10:00:00+05:00'
const FUTURE_START_B = '2030-07-22T10:30:00+05:00'
const FUTURE_START_C = '2030-07-22T11:00:00+05:00'

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
    const RefundAudit = (await import('../models/refundAuditModel.js')).default
    await RefundAudit.destroy({ where: {}, truncate: true })
    await Appointment.destroy({ where: {}, truncate: true })
    await Doctor.destroy({ where: {}, truncate: true })
    await User.destroy({ where: {}, truncate: true })
})

const seedUser = async (email) => {
    const salt = await bcrypt.genSalt(10)
    const hashed = await bcrypt.hash('password123', salt)
    return User.create({ name: 'Patient', email, password: hashed })
}

const seedDoctor = async (email = `doc_${Date.now()}@test.com`) => {
    const salt = await bcrypt.genSalt(10)
    const hashed = await bcrypt.hash('password123', salt)
    return Doctor.create({
        name: 'Dr Schedule',
        email,
        password: hashed,
        image: 'img.png',
        speciality: 'General physician',
        degree: 'MBBS',
        experience: '5 Year',
        about: 'Scheduling doctor',
        fees: 300,
        address: { line1: 'A', line2: 'B' },
        date: Date.now(),
        available: true,
        slots_booked: {},
    })
}

const loginToken = async (email) => {
    const res = await request(app).post('/api/user/login').send({ email, password: 'password123' })
    return res.body.token
}

describe('Scheduling protection', () => {
    test('Test 1 — two users booking the same slot: only one succeeds', async () => {
        await seedUser('a@test.com')
        await seedUser('b@test.com')
        const doctor = await seedDoctor()
        const tokenA = await loginToken('a@test.com')
        const tokenB = await loginToken('b@test.com')

        const resA = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

        const resB = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${tokenB}`)
            .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

        expect(resA.status).toBe(200)
        expect(resA.body.success).toBe(true)
        expect(resB.status).toBe(409)
        expect(resB.body.success).toBe(false)
        expect(resB.body.message).toMatch(/no longer available/i)

        const count = await Appointment.count({
            where: { docId: doctor.id, status: ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED'] },
        })
        expect(count).toBe(1)
    })

    test('Test 2 — 10 parallel booking requests: exactly one succeeds', async () => {
        const users = []
        for (let i = 0; i < 10; i++) {
            users.push(await seedUser(`parallel_${i}@test.com`))
        }
        const doctor = await seedDoctor()
        const tokens = await Promise.all(users.map((u) => loginToken(u.email)))

        const results = await Promise.all(
            tokens.map((token) =>
                request(app)
                    .post('/api/user/book-appointment')
                    .set('Authorization', `Bearer ${token}`)
                    .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })
            )
        )

        const successes = results.filter((r) => r.status === 200 && r.body.success)
        const failures = results.filter((r) => r.status === 409 || r.body.success === false)

        expect(successes).toHaveLength(1)
        expect(failures).toHaveLength(9)

        const count = await Appointment.count({ where: { docId: doctor.id } })
        expect(count).toBe(1)
    })

    test('Test 3 — invalid manual slot (not on interval) is rejected', async () => {
        await seedUser('invalid@test.com')
        const doctor = await seedDoctor()
        const token = await loginToken('invalid@test.com')

        const res = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token}`)
            .send({ docId: doctor.id, startTime: '2030-07-20T03:17:00+05:00', payMode: 'later' })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
    })

    test('Test 4 — outside working hours is rejected', async () => {
        await seedUser('hours@test.com')
        const doctor = await seedDoctor()
        const token = await loginToken('hours@test.com')

        const res = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token}`)
            .send({ docId: doctor.id, startTime: '2030-07-20T22:00:00+05:00', payMode: 'later' })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/working hours|interval/i)
    })

    test('Test 5 — past appointment is rejected', async () => {
        await seedUser('past@test.com')
        const doctor = await seedDoctor()
        const token = await loginToken('past@test.com')

        const res = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token}`)
            .send({ docId: doctor.id, startTime: '2020-07-20T10:00:00+05:00', payMode: 'later' })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/past/i)
    })

    test('Test 6 — cancel then rebook same slot succeeds', async () => {
        await seedUser('cancel@test.com')
        await seedUser('rebook@test.com')
        const doctor = await seedDoctor()
        const tokenA = await loginToken('cancel@test.com')
        const tokenB = await loginToken('rebook@test.com')

        const book = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

        expect(book.status).toBe(200)
        const appointmentId = book.body.appointment.id

        const cancel = await request(app)
            .post('/api/user/cancel-appointment')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ appointmentId })

        expect(cancel.status).toBe(200)

        const rebook = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${tokenB}`)
            .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

        expect(rebook.status).toBe(200)
        expect(rebook.body.success).toBe(true)

        const active = await Appointment.count({
            where: { docId: doctor.id, status: ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED'] },
        })
        expect(active).toBe(1)
    })

    test('Test 7 — reschedule into occupied slot is rejected', async () => {
        await seedUser('owner_a@test.com')
        await seedUser('owner_b@test.com')
        const doctor = await seedDoctor()
        const tokenA = await loginToken('owner_a@test.com')
        const tokenB = await loginToken('owner_b@test.com')

        const bookA = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

        const bookB = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${tokenB}`)
            .send({ docId: doctor.id, startTime: FUTURE_START_B, payMode: 'later' })

        expect(bookA.status).toBe(200)
        expect(bookB.status).toBe(200)

        const reschedule = await request(app)
            .post('/api/user/reschedule-appointment')
            .set('Authorization', `Bearer ${tokenB}`)
            .send({
                appointmentId: bookB.body.appointment.id,
                newStartTime: FUTURE_START,
            })

        expect(reschedule.status).toBe(409)
        expect(reschedule.body.message).toMatch(/no longer available/i)
    })

    test('rejects startTime without timezone offset', async () => {
        await seedUser('tz@test.com')
        const doctor = await seedDoctor()
        const token = await loginToken('tz@test.com')

        const res = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token}`)
            .send({ docId: doctor.id, startTime: '2030-07-20T10:00:00', payMode: 'later' })

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
    })

    test('legacy slotDate/slotTime still books when valid', async () => {
        await seedUser('legacy@test.com')
        const doctor = await seedDoctor()
        const token = await loginToken('legacy@test.com')

        const res = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token}`)
            .send({
                docId: doctor.id,
                slotDate: '22_7_2030',
                slotTime: '10:00 AM',
                payMode: 'later',
            })

        expect(res.status).toBe(200)
        expect(res.body.appointment.startTime).toBeDefined()
        expect(res.body.appointment.status).toBe('CONFIRMED')
    })

    test('successful book stores startTime and heldStartTime', async () => {
        await seedUser('fields@test.com')
        const doctor = await seedDoctor()
        const token = await loginToken('fields@test.com')

        const res = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token}`)
            .send({ docId: doctor.id, startTime: FUTURE_START_C, payMode: 'later' })

        expect(res.status).toBe(200)
        const appt = await Appointment.findByPk(res.body.appointment.id)
        expect(appt.startTime).toBeTruthy()
        expect(appt.heldStartTime).toBeTruthy()
        expect(new Date(appt.startTime).getTime()).toBe(new Date(appt.heldStartTime).getTime())
        expect(appt.status).toBe('CONFIRMED')
    })

    test('reschedule rejects completed appointments', async () => {
        await seedUser('done@test.com')
        const doctor = await seedDoctor()
        const token = await loginToken('done@test.com')

        const book = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token}`)
            .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

        const { completeAppointment, ACTOR_TYPE } = await import('../services/appointmentStateService.js')
        await completeAppointment(book.body.appointment.id, { actorType: ACTOR_TYPE.DOCTOR })

        const res = await request(app)
            .post('/api/user/reschedule-appointment')
            .set('Authorization', `Bearer ${token}`)
            .send({ appointmentId: book.body.appointment.id, newStartTime: FUTURE_START_B })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('not_reschedulable')
    })

    test('cancelled appointment releases slot for rebooking via status', async () => {
        await seedUser('slot_user@test.com')
        await seedUser('slot_user2@test.com')
        const doctor = await seedDoctor()
        const token1 = await loginToken('slot_user@test.com')
        const token2 = await loginToken('slot_user2@test.com')

        const book = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token1}`)
            .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })

        const cancel = await request(app)
            .post('/api/user/cancel-appointment')
            .set('Authorization', `Bearer ${token1}`)
            .send({ appointmentId: book.body.appointment.id })
        expect(cancel.body.success).toBe(true)

        const appt = await Appointment.findByPk(book.body.appointment.id)
        expect(appt.status).toBe('CANCELLED')
        expect(appt.heldStartTime).toBeNull()

        const rebook = await request(app)
            .post('/api/user/book-appointment')
            .set('Authorization', `Bearer ${token2}`)
            .send({ docId: doctor.id, startTime: FUTURE_START, payMode: 'later' })
        expect(rebook.status).toBe(200)
        expect(rebook.body.success).toBe(true)
    })
})

describe('slotTime helpers', () => {
    test('parseLegacySlot builds clinic-local datetime', async () => {
        const { parseLegacySlot: parse, toClinicParts } = await import('../utils/slotTime.js')
        const d = parse('22_7_2030', '10:00 AM')
        expect(d).toBeInstanceOf(Date)
        const parts = toClinicParts(d)
        expect(parts.hour).toBe(10)
        expect(parts.minute).toBe(0)
        expect(parts.day).toBe(22)
        expect(parts.month).toBe(7)
        expect(parts.year).toBe(2030)
    })
})
