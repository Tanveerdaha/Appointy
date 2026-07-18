import Stripe from 'stripe'
import { Op } from 'sequelize'
import sequelize from '../config/mysql.js'
import Appointment from '../models/appointmentModel.js'
import StripeWebhookEvent from '../models/stripeWebhookEventModel.js'
import StripePayment, {
    PAYMENT_STATUS,
    ACTIVE_PAYMENT_STATUSES,
} from '../models/stripePaymentModel.js'

const logStripe = (level, message, meta = {}) => {
    const payload = { service: 'stripePayment', ...meta }
    if (level === 'error') {
        console.error(`[stripe] ${message}`, payload)
    } else if (level === 'warn') {
        console.warn(`[stripe] ${message}`, payload)
    } else {
        console.log(`[stripe] ${message}`, payload)
    }
}

export const getStripe = () => {
    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('Stripe credentials not configured')
    }
    return new Stripe(process.env.STRIPE_SECRET_KEY)
}

export const getCurrency = () => (process.env.CURRENCY || 'pkr').toLowerCase()

export const getExpectedAmountCents = (appointment) =>
    Math.round(Number(appointment.amount) * 100)

/**
 * Create a Stripe Checkout Session.
 *
 * @param {object}  appointment
 * @param {string}  userId
 * @param {object}  [options]
 * @param {string}  [options.idempotencyKey] Stripe idempotency key. The SAME key
 *                  for a given payment attempt guarantees Stripe returns the same
 *                  session on retries instead of creating a duplicate.
 * @param {Date}    [options.expiresAt] When the session should expire.
 * @param {string}  [options.paymentId] StripePayment record id (stored in metadata
 *                  for precise webhook reconciliation).
 */
export const createStripeCheckoutSession = async (
    appointment,
    userId,
    { idempotencyKey, expiresAt, paymentId } = {}
) => {
    const stripe = getStripe()
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
    const currency = getCurrency()
    const amount = getExpectedAmountCents(appointment)

    const params = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
            quantity: 1,
            price_data: {
                currency,
                unit_amount: amount,
                product_data: {
                    name: 'Doctor Appointment',
                    description: `Appointment #${appointment.id}`,
                },
            },
        }],
        metadata: {
            appointmentId: String(appointment.id),
            userId: String(userId),
            ...(paymentId ? { paymentId: String(paymentId) } : {}),
        },
        // Ensures the underlying PaymentIntent carries the same metadata for
        // refunds / reconciliation / support investigations.
        payment_intent_data: {
            metadata: {
                appointmentId: String(appointment.id),
                userId: String(userId),
                ...(paymentId ? { paymentId: String(paymentId) } : {}),
            },
        },
        success_url: `${frontendUrl}/my-appointments?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/my-appointments?canceled=1`,
    }

    if (expiresAt instanceof Date && !Number.isNaN(expiresAt.getTime())) {
        params.expires_at = Math.floor(expiresAt.getTime() / 1000)
    }

    const requestOptions = idempotencyKey ? { idempotencyKey } : {}

    return stripe.checkout.sessions.create(params, requestOptions)
}

/**
 * Persist checkout session id and move appointment into pending payment state.
 */
export const markCheckoutSessionPending = async (appointmentId, sessionId, { transaction } = {}) => {
    await Appointment.update(
        {
            paymentStatus: 'pending',
            stripeCheckoutSessionId: sessionId,
        },
        { where: { id: appointmentId }, transaction }
    )
}

/**
 * Validate a Stripe Checkout Session against an appointment before marking paid.
 * Does not trust metadata alone — amount and currency must match.
 */
export const validateStripePayment = (session, appointment, { expectedUserId = null } = {}) => {
    if (!session) {
        return { ok: false, code: 'missing_session', message: 'Missing Stripe session' }
    }

    if (session.payment_status !== 'paid') {
        return { ok: false, code: 'not_paid', message: 'Payment not completed' }
    }

    const appointmentId = session.metadata?.appointmentId
    const metadataUserId = session.metadata?.userId

    if (!appointmentId || !metadataUserId) {
        return { ok: false, code: 'invalid_metadata', message: 'Invalid payment session metadata' }
    }

    if (!appointment) {
        return { ok: false, code: 'appointment_not_found', message: 'Appointment not found' }
    }

    if (String(appointment.id) !== String(appointmentId)) {
        return { ok: false, code: 'appointment_mismatch', message: 'Session does not match appointment' }
    }

    if (String(appointment.userId) !== String(metadataUserId)) {
        return { ok: false, code: 'ownership_mismatch', message: 'Session user does not match appointment' }
    }

    if (expectedUserId != null && String(expectedUserId) !== String(metadataUserId)) {
        return { ok: false, code: 'auth_user_mismatch', message: 'Unauthorized payment session' }
    }

    if (expectedUserId != null && String(appointment.userId) !== String(expectedUserId)) {
        return { ok: false, code: 'auth_appointment_mismatch', message: 'Unauthorized action' }
    }

    const expectedAmount = getExpectedAmountCents(appointment)
    const expectedCurrency = getCurrency()
    const sessionCurrency = String(session.currency || '').toLowerCase()

    if (Number(session.amount_total) !== expectedAmount) {
        logStripe('error', 'amount mismatch — refusing to mark paid', {
            appointmentId: appointment.id,
            expectedAmount,
            amountTotal: session.amount_total,
            sessionId: session.id,
        })
        return { ok: false, code: 'amount_mismatch', message: 'Payment amount mismatch' }
    }

    if (sessionCurrency !== expectedCurrency) {
        logStripe('error', 'currency mismatch — refusing to mark paid', {
            appointmentId: appointment.id,
            expectedCurrency,
            sessionCurrency,
            sessionId: session.id,
        })
        return { ok: false, code: 'currency_mismatch', message: 'Payment currency mismatch' }
    }

    return { ok: true, appointmentId, metadataUserId }
}

const claimWebhookEvent = async (stripeEventId, eventType, transaction) => {
    if (!stripeEventId) return { claimed: true, duplicate: false }

    const existing = await StripeWebhookEvent.findOne({
        where: { stripeEventId },
        transaction,
        lock: transaction.LOCK.UPDATE,
    })

    if (existing) {
        return { claimed: false, duplicate: true }
    }

    try {
        await StripeWebhookEvent.create(
            {
                stripeEventId,
                eventType: eventType || 'unknown',
                processedAt: new Date(),
            },
            { transaction }
        )
        return { claimed: true, duplicate: false }
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return { claimed: false, duplicate: true }
        }
        throw error
    }
}

const paymentIntentIdFromSession = (session) => {
    if (!session?.payment_intent) return null
    return typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent.id || null
}

/**
 * Move the dedicated StripePayment record to PAID (idempotent) and run duplicate
 * detection. Runs inside the caller's transaction so it commits atomically with
 * the appointment update.
 *
 * Duplicate detection: if a *different* session/intent is already PAID for this
 * appointment, we emit a CRITICAL_PAYMENT_DUPLICATE event instead of silently
 * ignoring it — this is the signal that two charges may exist for one booking.
 */
const recordStripePaymentPaid = async ({ appointmentId, session, transaction, stripeEventId }) => {
    const sessionId = session.id
    const paymentIntentId = paymentIntentIdFromSession(session)
    const paidAt = new Date()

    // Duplicate charge detection — another PAID payment on a different session.
    const conflictClauses = [{ stripeCheckoutSessionId: { [Op.ne]: sessionId } }]
    if (paymentIntentId) {
        conflictClauses.push({ stripePaymentIntentId: { [Op.ne]: paymentIntentId } })
    }
    const otherPaid = await StripePayment.findOne({
        where: {
            appointmentId,
            status: PAYMENT_STATUS.PAID,
            [Op.and]: conflictClauses,
        },
        transaction,
    })

    if (otherPaid) {
        logStripe('error', 'CRITICAL_PAYMENT_DUPLICATE — multiple paid Stripe payments for one appointment', {
            event: 'CRITICAL_PAYMENT_DUPLICATE',
            appointmentId,
            existingPaymentId: otherPaid.id,
            existingSessionId: otherPaid.stripeCheckoutSessionId,
            existingPaymentIntentId: otherPaid.stripePaymentIntentId,
            incomingSessionId: sessionId,
            incomingPaymentIntentId: paymentIntentId,
            stripeEventId,
        })
    }

    // Match the record created at checkout time; fall back to the payment intent.
    let payment = await StripePayment.findOne({
        where: { stripeCheckoutSessionId: sessionId },
        transaction,
        lock: transaction.LOCK.UPDATE,
    })

    if (!payment && paymentIntentId) {
        payment = await StripePayment.findOne({
            where: { stripePaymentIntentId: paymentIntentId },
            transaction,
            lock: transaction.LOCK.UPDATE,
        })
    }

    if (payment) {
        if (payment.status === PAYMENT_STATUS.PAID) {
            logStripe('info', 'stripe payment already marked paid — no-op', {
                appointmentId,
                paymentId: payment.id,
                sessionId,
            })
            return payment
        }
        await payment.update(
            {
                status: PAYMENT_STATUS.PAID,
                activeAppointmentId: null,
                stripePaymentIntentId: payment.stripePaymentIntentId || paymentIntentId,
                paidAt,
            },
            { transaction }
        )
        logStripe('info', 'stripe payment marked paid', {
            appointmentId,
            paymentId: payment.id,
            sessionId,
        })
        return payment
    }

    // No record existed (e.g. legacy appointment paid before this table). Create
    // one so reconciliation/refund tooling always has a payment object.
    const created = await StripePayment.create(
        {
            appointmentId,
            userId: session.metadata?.userId,
            stripeCheckoutSessionId: sessionId,
            stripePaymentIntentId: paymentIntentId,
            amount: Number(session.amount_total),
            currency: String(session.currency || getCurrency()).toLowerCase(),
            status: PAYMENT_STATUS.PAID,
            paidAt,
        },
        { transaction }
    )
    logStripe('info', 'stripe payment record created as paid', {
        appointmentId,
        paymentId: created.id,
        sessionId,
    })
    return created
}

/**
 * Authoritative payment reconciliation from a verified Stripe Checkout Session.
 * Used by webhooks (primary) and verify-stripe (UX helper).
 */
export const markAppointmentPaidFromCheckoutSession = async ({
    session,
    stripeEventId = null,
    eventType = null,
    expectedUserId = null,
}) => {
    return sequelize.transaction(async (transaction) => {
        const claim = await claimWebhookEvent(stripeEventId, eventType, transaction)
        if (claim.duplicate) {
            logStripe('info', 'duplicate webhook event — no-op', {
                stripeEventId,
                eventType,
                sessionId: session?.id,
            })
            return { status: 'duplicate', message: 'Event already processed' }
        }

        const appointmentId = session?.metadata?.appointmentId
        if (!appointmentId) {
            logStripe('error', 'invalid metadata — missing appointmentId', {
                stripeEventId,
                sessionId: session?.id,
            })
            return { status: 'rejected', code: 'invalid_metadata', message: 'Invalid payment session metadata' }
        }

        const appointment = await Appointment.findByPk(appointmentId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        })

        const validation = validateStripePayment(session, appointment, { expectedUserId })
        if (!validation.ok) {
            logStripe('warn', 'payment validation failed', {
                code: validation.code,
                appointmentId,
                sessionId: session?.id,
                stripeEventId,
            })
            return {
                status: 'rejected',
                code: validation.code,
                message: validation.message,
            }
        }

        if (appointment.cancelled) {
            logStripe('error', 'cancelled appointment received paid Stripe session — refund/reconciliation required', {
                appointmentId: appointment.id,
                sessionId: session.id,
                stripeEventId,
                paymentIntentId: paymentIntentIdFromSession(session),
                amountTotal: session.amount_total,
                currency: session.currency,
            })
            // Record Stripe identifiers for support/refund without reactivating the booking.
            await appointment.update(
                {
                    stripeCheckoutSessionId: session.id,
                    stripePaymentIntentId: paymentIntentIdFromSession(session),
                },
                { transaction }
            )
            await recordStripePaymentPaid({
                appointmentId: appointment.id,
                session,
                transaction,
                stripeEventId,
            })
            return {
                status: 'cancelled_paid',
                message: 'Payment received for cancelled appointment; requires refund handling',
                appointmentId: appointment.id,
            }
        }

        const alreadyPaid = appointment.paymentStatus === 'paid' || appointment.payment === true
        if (alreadyPaid) {
            logStripe('info', 'appointment already paid — no-op', {
                appointmentId: appointment.id,
                sessionId: session.id,
                stripeEventId,
            })
            // Keep Stripe identifiers up to date for reconciliation.
            await appointment.update(
                {
                    stripeCheckoutSessionId: appointment.stripeCheckoutSessionId || session.id,
                    stripePaymentIntentId:
                        appointment.stripePaymentIntentId || paymentIntentIdFromSession(session),
                    paidAt: appointment.paidAt || new Date(),
                },
                { transaction }
            )
            await recordStripePaymentPaid({
                appointmentId: appointment.id,
                session,
                transaction,
                stripeEventId,
            })
            return {
                status: 'already_paid',
                message: 'Payment already recorded',
                appointmentId: appointment.id,
                paymentStatus: 'paid',
                payment: true,
            }
        }

        const paidAt = new Date()
        const statusUpdate =
            !appointment.status || appointment.status === 'PENDING_PAYMENT'
                ? { status: 'CONFIRMED' }
                : {}
        await appointment.update(
            {
                payment: true,
                paymentStatus: 'paid',
                paidAt,
                stripeCheckoutSessionId: session.id,
                stripePaymentIntentId: paymentIntentIdFromSession(session),
                ...statusUpdate,
            },
            { transaction }
        )

        await recordStripePaymentPaid({
            appointmentId: appointment.id,
            session,
            transaction,
            stripeEventId,
        })

        logStripe('info', 'appointment marked paid', {
            appointmentId: appointment.id,
            sessionId: session.id,
            stripeEventId,
            eventType,
            paidAt: paidAt.toISOString(),
        })

        return {
            status: 'paid',
            message: 'Payment Successful',
            appointmentId: appointment.id,
            paymentStatus: 'paid',
            payment: true,
        }
    })
}

/**
 * UX / browser-return reconciliation. Never the sole source of truth in production
 * (webhooks are), but safely applies the same validation + paid transition.
 */
export const reconcileCheckoutSession = async (sessionId, { expectedUserId } = {}) => {
    if (!sessionId) {
        return { status: 'rejected', code: 'missing_session', message: 'Missing Stripe session id' }
    }

    const stripe = getStripe()
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    logStripe('info', 'reconcile checkout session', {
        sessionId,
        paymentStatus: session.payment_status,
        expectedUserId,
    })

    return markAppointmentPaidFromCheckoutSession({
        session,
        expectedUserId,
    })
}

/**
 * Safely handle expired checkout: pending → unpaid only for the active session.
 * Never downgrades paid.
 */
export const handleCheckoutSessionExpired = async ({
    session,
    stripeEventId = null,
    eventType = 'checkout.session.expired',
}) => {
    return sequelize.transaction(async (transaction) => {
        const claim = await claimWebhookEvent(stripeEventId, eventType, transaction)
        if (claim.duplicate) {
            return { status: 'duplicate', message: 'Event already processed' }
        }

        const appointmentId = session?.metadata?.appointmentId
        if (!appointmentId) {
            logStripe('warn', 'expired session missing appointmentId', { sessionId: session?.id })
            return { status: 'ignored', message: 'No appointment metadata' }
        }

        const appointment = await Appointment.findByPk(appointmentId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        })

        if (!appointment) {
            return { status: 'ignored', message: 'Appointment not found' }
        }

        if (appointment.paymentStatus === 'paid' || appointment.payment === true) {
            logStripe('info', 'ignoring expired session for already-paid appointment', {
                appointmentId: appointment.id,
                sessionId: session.id,
            })
            return { status: 'ignored', message: 'Appointment already paid' }
        }

        if (
            appointment.stripeCheckoutSessionId &&
            appointment.stripeCheckoutSessionId !== session.id
        ) {
            logStripe('info', 'ignoring expired session — not the active checkout session', {
                appointmentId: appointment.id,
                expiredSessionId: session.id,
                activeSessionId: appointment.stripeCheckoutSessionId,
            })
            return { status: 'ignored', message: 'Expired session is not active' }
        }

        if (appointment.paymentStatus === 'pending') {
            await appointment.update({ paymentStatus: 'unpaid' }, { transaction })
            await StripePayment.update(
                { status: PAYMENT_STATUS.EXPIRED, activeAppointmentId: null },
                {
                    where: {
                        stripeCheckoutSessionId: session.id,
                        status: ACTIVE_PAYMENT_STATUSES,
                    },
                    transaction,
                }
            )
            logStripe('info', 'pending payment reset to unpaid after session expiry', {
                appointmentId: appointment.id,
                sessionId: session.id,
            })
            return { status: 'expired', message: 'Checkout expired; payment reset to unpaid' }
        }

        return { status: 'ignored', message: 'No pending payment to expire' }
    })
}

export const handleAsyncPaymentFailed = async ({
    session,
    stripeEventId = null,
    eventType = 'checkout.session.async_payment_failed',
}) => {
    return sequelize.transaction(async (transaction) => {
        const claim = await claimWebhookEvent(stripeEventId, eventType, transaction)
        if (claim.duplicate) {
            return { status: 'duplicate', message: 'Event already processed' }
        }

        const appointmentId = session?.metadata?.appointmentId
        if (!appointmentId) {
            return { status: 'ignored', message: 'No appointment metadata' }
        }

        const appointment = await Appointment.findByPk(appointmentId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        })

        if (!appointment) {
            return { status: 'ignored', message: 'Appointment not found' }
        }

        if (appointment.paymentStatus === 'paid' || appointment.payment === true) {
            return { status: 'ignored', message: 'Appointment already paid' }
        }

        if (
            appointment.stripeCheckoutSessionId &&
            appointment.stripeCheckoutSessionId !== session.id
        ) {
            return { status: 'ignored', message: 'Failed session is not active' }
        }

        if (appointment.paymentStatus === 'pending') {
            await appointment.update({ paymentStatus: 'unpaid' }, { transaction })
            await StripePayment.update(
                { status: PAYMENT_STATUS.FAILED, activeAppointmentId: null },
                {
                    where: {
                        stripeCheckoutSessionId: session.id,
                        status: ACTIVE_PAYMENT_STATUSES,
                    },
                    transaction,
                }
            )
            logStripe('warn', 'async payment failed — reset to unpaid', {
                appointmentId: appointment.id,
                sessionId: session.id,
            })
            return { status: 'failed', message: 'Async payment failed' }
        }

        return { status: 'ignored', message: 'No pending payment to fail' }
    })
}
