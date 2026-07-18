import request from 'supertest'
import bcrypt from 'bcrypt'
import Stripe from 'stripe'

const WEBHOOK_SECRET = 'whsec_test_secret_for_stripe_webhooks'
const STRIPE_SECRET = 'sk_test_unit_stripe_secret'
const stripe = new Stripe(STRIPE_SECRET)

const buildCheckoutSession = ({
    appointmentId,
    userId,
    amountTotal,
    currency = 'pkr',
    paymentStatus = 'paid',
    sessionId = 'cs_test_session_1',
    paymentIntent = 'pi_test_intent_1',
} = {}) => ({
    id: sessionId,
    object: 'checkout.session',
    payment_status: paymentStatus,
    amount_total: amountTotal,
    currency,
    payment_intent: paymentIntent,
    metadata: {
        appointmentId: String(appointmentId),
        userId: String(userId),
    },
})

const buildEvent = (type, session, eventId = 'evt_test_1') => ({
    id: eventId,
    object: 'event',
    type,
    data: { object: session },
})

let app
let User, Doctor, Appointment, StripeWebhookEvent, StripePayment

beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.JWT_SECRET = 'test_jwt_secret'
    process.env.ADMIN_EMAIL = 'admin@test.com'
    process.env.ADMIN_PASSWORD = 'password123'
    process.env.DB_DIALECT = 'sqlite'
    process.env.SQLITE_STORAGE = ':memory:'
    process.env.STRIPE_SECRET_KEY = STRIPE_SECRET
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.CURRENCY = 'pkr'
    process.env.FRONTEND_URL = 'http://localhost:5173'

    const { createApp, initServices } = await import('../app.js')
    User = (await import('../models/userModel.js')).default
    Doctor = (await import('../models/doctorModel.js')).default
    Appointment = (await import('../models/appointmentModel.js')).default
    StripeWebhookEvent = (await import('../models/stripeWebhookEventModel.js')).default
    StripePayment = (await import('../models/stripePaymentModel.js')).default

    await initServices()
    app = createApp()
})

beforeEach(async () => {
    await StripePayment.destroy({ where: {}, truncate: true })
    await StripeWebhookEvent.destroy({ where: {}, truncate: true })
    await Appointment.destroy({ where: {}, truncate: true })
    await Doctor.destroy({ where: {}, truncate: true })
    await User.destroy({ where: {}, truncate: true })
})

const seedPendingAppointment = async ({
    amount = 500,
    cancelled = false,
    paymentStatus = 'pending',
    payment = false,
    sessionId = 'cs_test_session_1',
} = {}) => {
    const salt = await bcrypt.genSalt(10)
    const hashed = await bcrypt.hash('password123', salt)
    const user = await User.create({
        name: 'Patient',
        email: `patient_${Date.now()}_${Math.random()}@test.com`,
        password: hashed,
    })
    const doctor = await Doctor.create({
        name: 'Dr Pay',
        email: `doc_${Date.now()}_${Math.random()}@test.com`,
        password: hashed,
        image: 'img.png',
        speciality: 'General physician',
        degree: 'MBBS',
        experience: '5 Year',
        about: 'Pay doctor',
        fees: amount,
        address: { line1: 'A', line2: 'B' },
        date: Date.now(),
        slots_booked: {},
    })
    const appointment = await Appointment.create({
        userId: user.id,
        docId: doctor.id,
        userData: { id: user.id, name: user.name, email: user.email },
        docData: { id: doctor.id, name: doctor.name, fees: amount, address: doctor.address, image: doctor.image, speciality: doctor.speciality },
        amount,
        slotTime: '10:00 AM',
        slotDate: '18_7_2026',
        date: Date.now(),
        payment,
        paymentStatus,
        cancelled,
        stripeCheckoutSessionId: sessionId,
    })
    return { user, doctor, appointment }
}

/**
 * Send the exact signed payload bytes (supertest .send(JSON) re-serializes and breaks Stripe signatures).
 */
const postWebhook = (event, { secret = WEBHOOK_SECRET } = {}) => {
    const payload = JSON.stringify(event)
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret })

    return new Promise((resolve, reject) => {
        const req = request(app)
            .post('/api/webhooks/stripe')
            .set('Content-Type', 'application/json')
            .set('stripe-signature', header)
        req.write(payload)
        req.end((err, res) => (err ? reject(err) : resolve(res)))
    })
}

describe('Stripe webhook payment reliability', () => {
    test('valid checkout.session.completed marks appointment paid', async () => {
        const { user, appointment } = await seedPendingAppointment({ amount: 500 })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 50000,
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_valid_1')

        const res = await postWebhook(event)
        expect(res.status).toBe(200)
        expect(res.body.received).toBe(true)

        await appointment.reload()
        expect(appointment.payment).toBe(true)
        expect(appointment.paymentStatus).toBe('paid')
        expect(appointment.stripeCheckoutSessionId).toBe(session.id)
        expect(appointment.stripePaymentIntentId).toBe('pi_test_intent_1')
        expect(appointment.paidAt).toBeTruthy()
    })

    test('invalid Stripe signature returns 400 and leaves appointment unchanged', async () => {
        const { user, appointment } = await seedPendingAppointment({ amount: 500 })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 50000,
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_bad_sig')

        const res = await postWebhook(event, { secret: 'whsec_wrong_secret' })
        expect(res.status).toBe(400)

        await appointment.reload()
        expect(appointment.payment).toBe(false)
        expect(appointment.paymentStatus).toBe('pending')
    })

    test('missing signature returns 400', async () => {
        const res = await request(app)
            .post('/api/webhooks/stripe')
            .set('Content-Type', 'application/json')
            .send('{}')
        expect(res.status).toBe(400)
    })

    test('duplicate webhook event is idempotent', async () => {
        const { user, appointment } = await seedPendingAppointment({ amount: 500 })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 50000,
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_dup_1')

        const first = await postWebhook(event)
        const second = await postWebhook(event)
        expect(first.status).toBe(200)
        expect(second.status).toBe(200)

        await appointment.reload()
        expect(appointment.paymentStatus).toBe('paid')

        const eventCount = await StripeWebhookEvent.count({ where: { stripeEventId: 'evt_dup_1' } })
        expect(eventCount).toBe(1)
    })

    test('wrong user metadata does not mark appointment paid', async () => {
        const { appointment } = await seedPendingAppointment({ amount: 500 })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: '00000000-0000-0000-0000-000000000099',
            amountTotal: 50000,
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_wrong_user')

        const res = await postWebhook(event)
        expect(res.status).toBe(200)

        await appointment.reload()
        expect(appointment.payment).toBe(false)
        expect(appointment.paymentStatus).toBe('pending')
    })

    test('amount mismatch does not mark appointment paid', async () => {
        const { user, appointment } = await seedPendingAppointment({ amount: 500 })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 100,
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_amount_mismatch')

        const res = await postWebhook(event)
        expect(res.status).toBe(200)

        await appointment.reload()
        expect(appointment.payment).toBe(false)
        expect(appointment.paymentStatus).toBe('pending')
    })

    test('currency mismatch does not mark appointment paid', async () => {
        const { user, appointment } = await seedPendingAppointment({ amount: 500 })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 50000,
            currency: 'usd',
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_currency_mismatch')

        const res = await postWebhook(event)
        expect(res.status).toBe(200)

        await appointment.reload()
        expect(appointment.payment).toBe(false)
        expect(appointment.paymentStatus).toBe('pending')
    })

    test('cancelled appointment paid webhook does not reactivate booking', async () => {
        const { user, appointment } = await seedPendingAppointment({
            amount: 500,
            cancelled: true,
            paymentStatus: 'unpaid',
        })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 50000,
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_cancelled_paid')

        const res = await postWebhook(event)
        expect(res.status).toBe(200)

        await appointment.reload()
        expect(appointment.cancelled).toBe(true)
        expect(appointment.paymentStatus).not.toBe('paid')
        expect(appointment.payment).toBe(false)
        expect(appointment.stripeCheckoutSessionId).toBe(session.id)
        expect(appointment.stripePaymentIntentId).toBe('pi_test_intent_1')
    })

    test('already-paid appointment remains paid on replay', async () => {
        const { user, appointment } = await seedPendingAppointment({
            amount: 500,
            payment: true,
            paymentStatus: 'paid',
        })
        const paidAt = new Date('2026-01-01T00:00:00.000Z')
        await appointment.update({ paidAt })

        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 50000,
            sessionId: 'cs_test_replay',
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_already_paid')

        const res = await postWebhook(event)
        expect(res.status).toBe(200)

        await appointment.reload()
        expect(appointment.payment).toBe(true)
        expect(appointment.paymentStatus).toBe('paid')
    })

    test('browser never returns — webhook alone marks paid', async () => {
        const { user, appointment } = await seedPendingAppointment({
            amount: 750,
            sessionId: 'cs_test_no_browser',
        })
        expect(appointment.paymentStatus).toBe('pending')

        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 75000,
            sessionId: 'cs_test_no_browser',
        })
        const event = buildEvent('checkout.session.completed', session, 'evt_no_browser')

        // Intentionally do NOT call /verify-stripe
        const res = await postWebhook(event)
        expect(res.status).toBe(200)

        await appointment.reload()
        expect(appointment.payment).toBe(true)
        expect(appointment.paymentStatus).toBe('paid')
        expect(appointment.paidAt).toBeTruthy()
    })

    test('expired session resets pending to unpaid for active session only', async () => {
        const { user, appointment } = await seedPendingAppointment({
            amount: 500,
            sessionId: 'cs_active',
        })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 50000,
            sessionId: 'cs_active',
            paymentStatus: 'unpaid',
        })
        const event = buildEvent('checkout.session.expired', session, 'evt_expired')

        const res = await postWebhook(event)
        expect(res.status).toBe(200)

        await appointment.reload()
        expect(appointment.paymentStatus).toBe('unpaid')
        expect(appointment.payment).toBe(false)
    })

    test('expired session never downgrades paid appointment', async () => {
        const { user, appointment } = await seedPendingAppointment({
            amount: 500,
            payment: true,
            paymentStatus: 'paid',
            sessionId: 'cs_old',
        })
        const session = buildCheckoutSession({
            appointmentId: appointment.id,
            userId: user.id,
            amountTotal: 50000,
            sessionId: 'cs_old',
            paymentStatus: 'unpaid',
        })
        const event = buildEvent('checkout.session.expired', session, 'evt_expired_paid')

        const res = await postWebhook(event)
        expect(res.status).toBe(200)

        await appointment.reload()
        expect(appointment.paymentStatus).toBe('paid')
        expect(appointment.payment).toBe(true)
    })
})

describe('validateStripePayment unit cases', () => {
    test('rejects missing metadata', async () => {
        const { validateStripePayment } = await import('../services/stripePaymentService.js')
        const result = validateStripePayment(
            { payment_status: 'paid', metadata: {}, amount_total: 100, currency: 'pkr' },
            { id: 'a1', userId: 'u1', amount: 1 }
        )
        expect(result.ok).toBe(false)
        expect(result.code).toBe('invalid_metadata')
    })
})
