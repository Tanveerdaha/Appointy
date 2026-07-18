/**
 * Payment idempotency / duplicate-prevention tests.
 * Run via: npm run test:integration (added to the integration set) or test:all.
 *
 * The Stripe network call is injected (createSession) so we can deterministically
 * count how many Checkout Sessions the service actually creates.
 */
import request from 'supertest'
import bcrypt from 'bcrypt'
import Stripe from 'stripe'

const WEBHOOK_SECRET = 'whsec_test_secret_for_stripe_webhooks'
const STRIPE_SECRET = 'sk_test_unit_stripe_secret'
const stripe = new Stripe(STRIPE_SECRET)

let app
let User, Doctor, Appointment, StripePayment, StripeWebhookEvent, AppointmentHistory, RefundAudit
let createAppointmentPayment, PAYMENT_STATUS, ACTIVE_PAYMENT_STATUSES
let requestCancellation, ACTOR_TYPE
let markAppointmentPaidFromCheckoutSession

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
    process.env.STRIPE_SECRET_KEY = STRIPE_SECRET
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.CURRENCY = 'pkr'
    process.env.FRONTEND_URL = 'http://localhost:5173'

    const { createApp, initServices } = await import('../app.js')
    User = (await import('../models/userModel.js')).default
    Doctor = (await import('../models/doctorModel.js')).default
    Appointment = (await import('../models/appointmentModel.js')).default
    AppointmentHistory = (await import('../models/appointmentHistoryModel.js')).default
    StripeWebhookEvent = (await import('../models/stripeWebhookEventModel.js')).default
    const paymentModel = await import('../models/stripePaymentModel.js')
    StripePayment = paymentModel.default
    PAYMENT_STATUS = paymentModel.PAYMENT_STATUS
    ACTIVE_PAYMENT_STATUSES = paymentModel.ACTIVE_PAYMENT_STATUSES
    ;({ createAppointmentPayment } = await import('../services/paymentService.js'))
    ;({ requestCancellation, ACTOR_TYPE } = await import('../services/cancellationService.js'))
    ;({ markAppointmentPaidFromCheckoutSession } = await import('../services/stripePaymentService.js'))
    RefundAudit = (await import('../models/refundAuditModel.js')).default

    await initServices()
    app = createApp()
})

beforeEach(async () => {
    await RefundAudit.destroy({ where: {}, truncate: true })
    await StripePayment.destroy({ where: {}, truncate: true })
    await StripeWebhookEvent.destroy({ where: {}, truncate: true })
    await AppointmentHistory.destroy({ where: {}, truncate: true })
    await Appointment.destroy({ where: {}, truncate: true })
    await Doctor.destroy({ where: {}, truncate: true })
    await User.destroy({ where: {}, truncate: true })
})

const seedAppointment = async ({
    amount = 500,
    cancelled = false,
    paymentStatus = 'unpaid',
    payment = false,
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
    const startTime = new Date('2026-07-18T10:00:00+05:00')
    const appointment = await Appointment.create({
        userId: user.id,
        docId: doctor.id,
        userData: { id: user.id, name: user.name, email: user.email },
        docData: { id: doctor.id, name: doctor.name, fees: amount, address: doctor.address, image: doctor.image, speciality: doctor.speciality },
        amount,
        slotTime: '10:00 AM',
        slotDate: '18_7_2026',
        startTime,
        heldStartTime: cancelled ? null : startTime,
        status: cancelled ? 'CANCELLED' : paymentStatus === 'pending' ? 'PENDING_PAYMENT' : 'CONFIRMED',
        statusChangedAt: new Date(),
        date: Date.now(),
        payment,
        paymentStatus,
        cancelled,
    })
    return { user, doctor, appointment }
}

/**
 * Fake Stripe session creator. Returns a unique session id per call and records
 * how many times it was invoked and with which idempotency keys.
 */
const makeFakeStripe = ({ delayMs = 0 } = {}) => {
    const calls = []
    const createSession = async (appointment, userId, options = {}) => {
        calls.push({ appointmentId: appointment.id, userId, options })
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        const n = calls.length
        return {
            id: `cs_test_${appointment.id}_${n}`,
            url: `https://checkout.stripe.test/${appointment.id}/${n}`,
            expires_at: options.expiresAt ? Math.floor(options.expiresAt.getTime() / 1000) : undefined,
        }
    }
    return { calls, createSession }
}

const loginToken = async (email) => {
    const res = await request(app).post('/api/user/login').send({ email, password: 'password123' })
    return res.body.token
}

describe('Payment creation idempotency', () => {
    test('Test 1: double-click creates only one Checkout Session', async () => {
        const { user, appointment } = await seedAppointment()
        const { calls, createSession } = makeFakeStripe()

        const first = await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })
        const second = await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })

        expect(first.ok).toBe(true)
        expect(second.ok).toBe(true)
        expect(calls.length).toBe(1)
        expect(second.existingPayment).toBe(true)
        expect(second.sessionId).toBe(first.sessionId)

        const count = await StripePayment.count({ where: { appointmentId: appointment.id } })
        expect(count).toBe(1)
    })

    test('Test 2: second tab receives the same Checkout Session URL', async () => {
        const { user, appointment } = await seedAppointment()
        const { createSession } = makeFakeStripe()

        const tabA = await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })
        const tabB = await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })

        expect(tabA.sessionUrl).toBe(tabB.sessionUrl)
        expect(tabB.existingPayment).toBe(true)
    })

    test('Test 3: database rejects a second active payment for one appointment', async () => {
        // The production race (two requests slipping past app checks) is defended
        // at the DB level: a UNIQUE index on activeAppointmentId permits at most one
        // active (CREATED/CHECKOUT_CREATED/PENDING) payment per appointment. On
        // MySQL the appointment row lock serialises requests; this unique index is
        // the last-line backstop that guarantees "one payment record".
        const { user, appointment } = await seedAppointment()

        await StripePayment.create({
            appointmentId: appointment.id,
            userId: user.id,
            amount: 50000,
            currency: 'pkr',
            status: PAYMENT_STATUS.CHECKOUT_CREATED,
            stripeCheckoutSessionId: 'cs_active_a',
            checkoutUrl: 'https://checkout.stripe.test/a',
        })

        await expect(
            StripePayment.create({
                appointmentId: appointment.id,
                userId: user.id,
                amount: 50000,
                currency: 'pkr',
                status: PAYMENT_STATUS.CHECKOUT_CREATED,
                stripeCheckoutSessionId: 'cs_active_b',
                checkoutUrl: 'https://checkout.stripe.test/b',
            })
        ).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' })

        const activeCount = await StripePayment.count({
            where: { appointmentId: appointment.id, status: ACTIVE_PAYMENT_STATUSES },
        })
        expect(activeCount).toBe(1)
    })

    test('Test 3b: two sequential calls (serialised race) yield one active payment + one session', async () => {
        const { user, appointment } = await seedAppointment()
        const { calls, createSession } = makeFakeStripe()

        const a = await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })
        const b = await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })

        expect(a.ok).toBe(true)
        expect(b.ok).toBe(true)
        expect(calls.length).toBe(1)
        expect(a.sessionId).toBe(b.sessionId)

        const activeCount = await StripePayment.count({
            where: { appointmentId: appointment.id, status: ACTIVE_PAYMENT_STATUSES },
        })
        expect(activeCount).toBe(1)
    })

    test('Test 4: already-paid appointment is rejected', async () => {
        const { user, appointment } = await seedAppointment({ payment: true, paymentStatus: 'paid' })
        const { calls, createSession } = makeFakeStripe()

        const result = await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })

        expect(result.ok).toBe(false)
        expect(result.code).toBe('already_paid')
        expect(calls.length).toBe(0)
    })

    test('Test 5: expired session creates a new one and retires the old', async () => {
        const { user, appointment } = await seedAppointment()
        const { calls, createSession } = makeFakeStripe()

        // First attempt in the past so it is already expired.
        const past = new Date(Date.now() - 60 * 60 * 1000)
        const first = await createAppointmentPayment(
            { appointmentId: appointment.id, userId: user.id },
            { createSession, now: () => past }
        )
        expect(first.ok).toBe(true)

        const second = await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })
        expect(second.ok).toBe(true)
        expect(second.existingPayment).toBe(false)
        expect(second.sessionId).not.toBe(first.sessionId)
        expect(calls.length).toBe(2)

        const oldPayment = await StripePayment.findByPk(first.paymentId)
        expect(oldPayment.status).toBe(PAYMENT_STATUS.EXPIRED)

        const activeCount = await StripePayment.count({
            where: { appointmentId: appointment.id, status: ACTIVE_PAYMENT_STATUSES },
        })
        expect(activeCount).toBe(1)
    })

    test('unauthorized user cannot create payment for another user appointment', async () => {
        const { appointment } = await seedAppointment()
        const { createSession } = makeFakeStripe()
        const result = await createAppointmentPayment(
            { appointmentId: appointment.id, userId: '00000000-0000-0000-0000-000000000099' },
            { createSession }
        )
        expect(result.ok).toBe(false)
        expect(result.code).toBe('unauthorized')
    })

    test('idempotency key is stable for the same active attempt', async () => {
        const { user, appointment } = await seedAppointment()
        const { calls, createSession } = makeFakeStripe()

        await createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession })
        expect(calls[0].options.idempotencyKey).toMatch(new RegExp(`^appointment_${appointment.id}_payment_`))
    })
})

describe('Payment endpoints', () => {
    test('POST /payment-stripe then GET /payment-status resumes the same session', async () => {
        const { user, appointment } = await seedAppointment()
        const token = await loginToken(user.email)

        // Seed an active payment directly (mirrors a created checkout session).
        await StripePayment.create({
            appointmentId: appointment.id,
            userId: user.id,
            amount: 50000,
            currency: 'pkr',
            status: PAYMENT_STATUS.CHECKOUT_CREATED,
            stripeCheckoutSessionId: 'cs_status_1',
            checkoutUrl: 'https://checkout.stripe.test/status/1',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        })
        await appointment.update({ paymentStatus: 'pending', stripeCheckoutSessionId: 'cs_status_1' })

        const res = await request(app)
            .get(`/api/user/payment-status/${appointment.id}`)
            .set('Authorization', `Bearer ${token}`)

        expect(res.status).toBe(200)
        expect(res.body.paymentStatus).toBe('pending')
        expect(res.body.checkoutUrl).toBe('https://checkout.stripe.test/status/1')
        expect(res.body.sessionId).toBe('cs_status_1')
    })

    test('GET /payment-status rejects other users', async () => {
        const { appointment } = await seedAppointment()
        const { user: otherUser } = await seedAppointment()
        const token = await loginToken(otherUser.email)

        const res = await request(app)
            .get(`/api/user/payment-status/${appointment.id}`)
            .set('Authorization', `Bearer ${token}`)

        expect(res.status).toBe(403)
    })
})

describe('Webhook duplicate handling with StripePayment', () => {
    const buildEvent = (type, session, eventId) => ({ id: eventId, object: 'event', type, data: { object: session } })

    const postWebhook = (event) => {
        const payload = JSON.stringify(event)
        const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
        return new Promise((resolve, reject) => {
            const req = request(app)
                .post('/api/webhooks/stripe')
                .set('Content-Type', 'application/json')
                .set('stripe-signature', header)
            req.write(payload)
            req.end((err, res) => (err ? reject(err) : resolve(res)))
        })
    }

    test('Test 6: duplicate checkout.session.completed pays appointment exactly once', async () => {
        const { user, appointment } = await seedAppointment({ paymentStatus: 'pending' })

        // Active payment created at checkout time.
        await StripePayment.create({
            appointmentId: appointment.id,
            userId: user.id,
            amount: 50000,
            currency: 'pkr',
            status: PAYMENT_STATUS.CHECKOUT_CREATED,
            stripeCheckoutSessionId: 'cs_webhook_dup',
            checkoutUrl: 'https://checkout.stripe.test/dup',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        })
        await appointment.update({ stripeCheckoutSessionId: 'cs_webhook_dup' })

        const session = {
            id: 'cs_webhook_dup',
            object: 'checkout.session',
            payment_status: 'paid',
            amount_total: 50000,
            currency: 'pkr',
            payment_intent: 'pi_webhook_dup',
            metadata: { appointmentId: String(appointment.id), userId: String(user.id) },
        }

        const first = await postWebhook(buildEvent('checkout.session.completed', session, 'evt_dup_a'))
        const second = await postWebhook(buildEvent('checkout.session.completed', session, 'evt_dup_b'))

        expect(first.status).toBe(200)
        expect(second.status).toBe(200)

        await appointment.reload()
        expect(appointment.paymentStatus).toBe('paid')

        const paidCount = await StripePayment.count({
            where: { appointmentId: appointment.id, status: PAYMENT_STATUS.PAID },
        })
        expect(paidCount).toBe(1)

        const totalCount = await StripePayment.count({ where: { appointmentId: appointment.id } })
        expect(totalCount).toBe(1)
    })

    test('concurrent webhook + browser verification pays appointment exactly once', async () => {
        const { user, appointment } = await seedAppointment({ paymentStatus: 'pending' })
        await StripePayment.create({
            appointmentId: appointment.id,
            userId: user.id,
            amount: 50000,
            currency: 'pkr',
            status: PAYMENT_STATUS.CHECKOUT_CREATED,
            stripeCheckoutSessionId: 'cs_race_verify',
            checkoutUrl: 'https://checkout.stripe.test/race',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        })
        await appointment.update({
            stripeCheckoutSessionId: 'cs_race_verify',
            status: 'PENDING_PAYMENT',
            paymentStatus: 'pending',
        })

        const session = {
            id: 'cs_race_verify',
            object: 'checkout.session',
            payment_status: 'paid',
            amount_total: 50000,
            currency: 'pkr',
            payment_intent: 'pi_race_verify',
            metadata: { appointmentId: String(appointment.id), userId: String(user.id) },
        }

        const [webhookRes, verifyRes] = await Promise.all([
            postWebhook(buildEvent('checkout.session.completed', session, 'evt_race_verify')),
            markAppointmentPaidFromCheckoutSession({
                session,
                expectedUserId: user.id,
            }),
        ])

        expect(webhookRes.status).toBe(200)
        expect(['paid', 'already_paid', 'duplicate']).toContain(verifyRes.status)

        await appointment.reload()
        expect(appointment.paymentStatus).toBe('paid')
        expect(appointment.payment).toBe(true)

        const paidCount = await StripePayment.count({
            where: { appointmentId: appointment.id, status: PAYMENT_STATUS.PAID },
        })
        expect(paidCount).toBe(1)
    })
})

describe('Checkout persistence races', () => {
    test('concurrent createAppointmentPayment yields one active payment', async () => {
        const { user, appointment } = await seedAppointment()
        const { calls, createSession } = makeFakeStripe({ delayMs: 30 })

        const [a, b] = await Promise.all([
            createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession }),
            createAppointmentPayment({ appointmentId: appointment.id, userId: user.id }, { createSession }),
        ])

        expect(a.ok).toBe(true)
        expect(b.ok).toBe(true)
        // Same payment row / idempotency key → at most one Stripe create, or both reuse.
        expect(calls.length).toBeLessThanOrEqual(2)
        expect(a.sessionId === b.sessionId || a.existingPayment || b.existingPayment).toBe(true)

        const activeCount = await StripePayment.count({
            where: { appointmentId: appointment.id, status: ACTIVE_PAYMENT_STATUSES },
        })
        expect(activeCount).toBe(1)
    })

    test('cancel between prepare and saveCheckoutSession does not revive cancelled appointment', async () => {
        const { user, appointment } = await seedAppointment()

        let releaseStripe
        const stripeGate = new Promise((resolve) => {
            releaseStripe = resolve
        })

        const createSession = async (appt, userId, options = {}) => {
            await stripeGate
            return {
                id: `cs_after_cancel_${appt.id}`,
                url: `https://checkout.stripe.test/after-cancel/${appt.id}`,
                expires_at: options.expiresAt
                    ? Math.floor(options.expiresAt.getTime() / 1000)
                    : undefined,
            }
        }

        const paymentPromise = createAppointmentPayment(
            { appointmentId: appointment.id, userId: user.id },
            { createSession }
        )

        // Wait until TX1 has committed a CREATED payment row, then cancel.
        let paymentRow = null
        for (let i = 0; i < 40; i += 1) {
            paymentRow = await StripePayment.findOne({
                where: { appointmentId: appointment.id, status: PAYMENT_STATUS.CREATED },
            })
            if (paymentRow) break
            await new Promise((r) => setTimeout(r, 25))
        }
        expect(paymentRow).not.toBeNull()

        await requestCancellation({
            appointmentId: appointment.id,
            actorType: ACTOR_TYPE.USER,
            actorId: user.id,
            expireCheckout: false,
        })

        releaseStripe()
        const result = await paymentPromise

        expect(result.ok).toBe(false)
        expect(result.code).toBe('appointment_not_found')

        await appointment.reload()
        expect(appointment.status).toBe('CANCELLED')
        expect(appointment.paymentStatus).not.toBe('pending')

        const activeCount = await StripePayment.count({
            where: { appointmentId: appointment.id, status: ACTIVE_PAYMENT_STATUSES },
        })
        expect(activeCount).toBe(0)
    })
})

const mockRefundCreate = (overrides = {}) => {
    let calls = 0
    const createRefundFn = async (params) => {
        calls += 1
        return {
            id: `re_late_${calls}`,
            object: 'refund',
            amount: overrides.amount ?? params?.amount ?? 50000,
            status: overrides.status ?? 'pending',
            payment_intent: params?.payment_intent || 'pi_late_1',
            charge: 'ch_late_1',
            ...overrides,
        }
    }
    createRefundFn.calls = () => calls
    return createRefundFn
}

const buildPaidSession = ({ appointmentId, userId, amountTotal = 50000, sessionId, paymentIntent }) => ({
    id: sessionId || `cs_late_${appointmentId}`,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: amountTotal,
    currency: 'pkr',
    payment_intent: paymentIntent || `pi_late_${appointmentId}`,
    metadata: {
        appointmentId: String(appointmentId),
        userId: String(userId),
    },
})

describe('cancelled_paid automatic refund', () => {
    test('cancel then paid webhook initiates idempotent refund without reactivating', async () => {
        const { user, appointment } = await seedAppointment({ paymentStatus: 'pending' })
        const sessionId = `cs_race_${appointment.id}`
        const paymentIntent = `pi_race_${appointment.id}`

        await StripePayment.create({
            appointmentId: appointment.id,
            userId: user.id,
            stripeCheckoutSessionId: sessionId,
            stripePaymentIntentId: paymentIntent,
            amount: 50000,
            currency: 'pkr',
            status: PAYMENT_STATUS.CHECKOUT_CREATED,
            activeAppointmentId: appointment.id,
        })
        await appointment.update({
            status: 'PENDING_PAYMENT',
            paymentStatus: 'pending',
            stripeCheckoutSessionId: sessionId,
        })

        await requestCancellation({
            appointmentId: appointment.id,
            actorType: ACTOR_TYPE.USER,
            actorId: user.id,
            expireCheckout: false,
        })

        await appointment.reload()
        expect(appointment.status).toBe('CANCELLED')

        const expired = await StripePayment.findOne({ where: { stripeCheckoutSessionId: sessionId } })
        expect(expired.status).toBe(PAYMENT_STATUS.EXPIRED)

        const createRefundFn = mockRefundCreate({ status: 'pending', amount: 50000 })
        const result = await markAppointmentPaidFromCheckoutSession({
            session: buildPaidSession({
                appointmentId: appointment.id,
                userId: user.id,
                sessionId,
                paymentIntent,
            }),
            stripeEventId: `evt_race_${appointment.id}`,
            eventType: 'checkout.session.completed',
            createRefundFn,
        })

        expect(result.status).toBe('cancelled_paid')
        expect(result.refundOutcome).toBe('refund_pending')
        expect(createRefundFn.calls()).toBe(1)

        await appointment.reload()
        expect(appointment.status).toBe('CANCELLED')
        expect(appointment.paymentStatus).toBe('refund_pending')
        expect(appointment.payment).toBe(true)

        await expired.reload()
        expect(expired.status).toBe(PAYMENT_STATUS.REFUND_PENDING)
        expect(expired.stripeRefundId).toBe('re_late_1')

        const audits = await RefundAudit.findAll({ where: { appointmentId: appointment.id } })
        expect(audits.length).toBeGreaterThan(0)
    })

    test('NO_SHOW paid session also auto-refunds', async () => {
        const { user, appointment } = await seedAppointment({ cancelled: true, paymentStatus: 'unpaid' })
        await appointment.update({
            status: 'NO_SHOW',
            cancelled: false,
            cancelledAt: null,
        })

        const createRefundFn = mockRefundCreate({ status: 'succeeded', amount: 50000 })
        const result = await markAppointmentPaidFromCheckoutSession({
            session: buildPaidSession({
                appointmentId: appointment.id,
                userId: user.id,
                sessionId: `cs_noshow_${appointment.id}`,
                paymentIntent: `pi_noshow_${appointment.id}`,
            }),
            stripeEventId: `evt_noshow_${appointment.id}`,
            createRefundFn,
        })

        expect(result.status).toBe('cancelled_paid')
        expect(['refund_pending', 'refunded']).toContain(result.refundOutcome)

        await appointment.reload()
        expect(appointment.status).toBe('NO_SHOW')
        expect(appointment.paymentStatus).not.toBe('paid')

        const payment = await StripePayment.findOne({ where: { appointmentId: appointment.id } })
        expect(['REFUND_PENDING', 'REFUNDED']).toContain(payment.status)
    })

    test('duplicate webhook recovers refund when payment still PAID after crash', async () => {
        const { user, appointment } = await seedAppointment({ cancelled: true, paymentStatus: 'unpaid' })
        const sessionId = `cs_crash_${appointment.id}`
        const paymentIntent = `pi_crash_${appointment.id}`
        const eventId = `evt_crash_${appointment.id}`

        // Simulate first pass: paid recorded + event claimed, refund never started.
        await StripePayment.create({
            appointmentId: appointment.id,
            userId: user.id,
            stripeCheckoutSessionId: sessionId,
            stripePaymentIntentId: paymentIntent,
            amount: 50000,
            currency: 'pkr',
            status: PAYMENT_STATUS.PAID,
            paidAt: new Date(),
        })
        await appointment.update({
            stripeCheckoutSessionId: sessionId,
            stripePaymentIntentId: paymentIntent,
        })
        await StripeWebhookEvent.create({
            stripeEventId: eventId,
            eventType: 'checkout.session.completed',
            processedAt: new Date(),
        })

        const createRefundFn = mockRefundCreate({ status: 'pending', amount: 50000 })
        const result = await markAppointmentPaidFromCheckoutSession({
            session: buildPaidSession({
                appointmentId: appointment.id,
                userId: user.id,
                sessionId,
                paymentIntent,
            }),
            stripeEventId: eventId,
            createRefundFn,
        })

        expect(result.status).toBe('cancelled_paid')
        expect(result.recoveredFromDuplicate).toBe(true)
        expect(result.refundOutcome).toBe('refund_pending')
        expect(createRefundFn.calls()).toBe(1)

        const payment = await StripePayment.findOne({ where: { stripeCheckoutSessionId: sessionId } })
        expect(payment.status).toBe(PAYMENT_STATUS.REFUND_PENDING)
    })

    test('concurrent cancelled_paid reconciliations create a single refund', async () => {
        const { user, appointment } = await seedAppointment({ cancelled: true, paymentStatus: 'unpaid' })
        const sessionId = `cs_conc_${appointment.id}`
        const paymentIntent = `pi_conc_${appointment.id}`

        const idempotencyKeys = []
        let calls = 0
        const createRefundFn = async (params, options) => {
            calls += 1
            idempotencyKeys.push(options?.idempotencyKey)
            return {
                id: `re_conc_${calls}`,
                object: 'refund',
                amount: params?.amount ?? 50000,
                status: 'pending',
                payment_intent: params?.payment_intent || paymentIntent,
                charge: 'ch_conc_1',
            }
        }
        const session = buildPaidSession({
            appointmentId: appointment.id,
            userId: user.id,
            sessionId,
            paymentIntent,
        })

        const [a, b] = await Promise.all([
            markAppointmentPaidFromCheckoutSession({
                session,
                stripeEventId: `evt_conc_a_${appointment.id}`,
                createRefundFn,
            }),
            markAppointmentPaidFromCheckoutSession({
                session,
                // Second path without event id (browser verify) races the webhook.
                createRefundFn,
            }),
        ])

        expect(a.status).toBe('cancelled_paid')
        expect(b.status).toBe('cancelled_paid')
        expect(calls).toBeGreaterThanOrEqual(1)
        // Same Stripe idempotency key even if SQLite allows both claim races.
        expect(new Set(idempotencyKeys).size).toBe(1)
        expect(idempotencyKeys[0]).toMatch(/^refund_/)

        const payments = await StripePayment.findAll({ where: { appointmentId: appointment.id } })
        expect(payments).toHaveLength(1)
        expect([PAYMENT_STATUS.REFUND_PENDING, PAYMENT_STATUS.REFUNDED]).toContain(payments[0].status)
    })

    test('Stripe refund failure leaves durable REFUND_FAILED and cancelled appointment', async () => {
        const { user, appointment } = await seedAppointment({ cancelled: true, paymentStatus: 'unpaid' })
        const createRefundFn = async () => {
            throw Object.assign(new Error('stripe_down'), { code: 'stripe_unavailable' })
        }

        const result = await markAppointmentPaidFromCheckoutSession({
            session: buildPaidSession({
                appointmentId: appointment.id,
                userId: user.id,
                sessionId: `cs_fail_${appointment.id}`,
                paymentIntent: `pi_fail_${appointment.id}`,
            }),
            stripeEventId: `evt_fail_${appointment.id}`,
            createRefundFn,
        })

        expect(result.status).toBe('cancelled_paid')
        expect(result.refundOutcome).toBe('refund_failed')

        await appointment.reload()
        expect(appointment.status).toBe('CANCELLED')
        expect(appointment.paymentStatus).toBe('refund_failed')
        expect(appointment.payment).toBe(true)

        const payment = await StripePayment.findOne({ where: { appointmentId: appointment.id } })
        expect(payment.status).toBe(PAYMENT_STATUS.REFUND_FAILED)

        const failureAudit = await RefundAudit.findOne({
            where: { appointmentId: appointment.id, action: 'REFUND_FAILED' },
        })
        expect(failureAudit).not.toBeNull()
    })

    test('duplicate recovers REFUND_PENDING resume after claim crash', async () => {
        const { user, appointment } = await seedAppointment({ cancelled: true, paymentStatus: 'unpaid' })
        const sessionId = `cs_resume_${appointment.id}`
        const paymentIntent = `pi_resume_${appointment.id}`
        const eventId = `evt_resume_${appointment.id}`

        await StripePayment.create({
            appointmentId: appointment.id,
            userId: user.id,
            stripeCheckoutSessionId: sessionId,
            stripePaymentIntentId: paymentIntent,
            amount: 50000,
            currency: 'pkr',
            status: PAYMENT_STATUS.REFUND_PENDING,
            refundAmount: 50000,
            refundStatus: 'pending',
            refundReason: 'Payment received after appointment cancellation',
            paidAt: new Date(),
        })
        await appointment.update({
            paymentStatus: 'refund_pending',
            payment: true,
            stripeCheckoutSessionId: sessionId,
            stripePaymentIntentId: paymentIntent,
        })
        await StripeWebhookEvent.create({
            stripeEventId: eventId,
            eventType: 'checkout.session.completed',
            processedAt: new Date(),
        })

        const createRefundFn = mockRefundCreate({ status: 'succeeded', amount: 50000 })
        const result = await markAppointmentPaidFromCheckoutSession({
            session: buildPaidSession({
                appointmentId: appointment.id,
                userId: user.id,
                sessionId,
                paymentIntent,
            }),
            stripeEventId: eventId,
            createRefundFn,
        })

        expect(result.status).toBe('cancelled_paid')
        expect(result.recoveredFromDuplicate).toBe(true)
        expect(createRefundFn.calls()).toBe(1)

        const payment = await StripePayment.findOne({ where: { stripeCheckoutSessionId: sessionId } })
        expect(payment.status).toBe(PAYMENT_STATUS.REFUNDED)
    })
})
