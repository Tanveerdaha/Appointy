import Appointment from '../models/appointmentModel.js'
import StripePayment, {
    PAYMENT_STATUS,
    ACTIVE_PAYMENT_STATUSES,
    APPOINTMENT_PAYMENT_STATUS,
} from '../models/stripePaymentModel.js'
import {
    createStripeCheckoutSession,
    getCurrency,
    getExpectedAmountCents,
} from './stripePaymentService.js'
import {
    APPOINTMENT_STATUS,
} from './appointmentStateService.js'
import { withTransaction } from '../utils/databaseTransaction.js'

const logPayment = (level, message, meta = {}) => {
    const payload = { service: 'paymentService', ...meta }
    if (level === 'error') {
        console.error(`[payment] ${message}`, payload)
    } else if (level === 'warn') {
        console.warn(`[payment] ${message}`, payload)
    } else {
        console.log(`[payment] ${message}`, payload)
    }
}

// Stripe requires expiry between 30 minutes and 24 hours from now.
const DEFAULT_EXPIRY_MINUTES = Number(process.env.STRIPE_CHECKOUT_EXPIRY_MINUTES || 60)
const EXPIRY_MS = Math.min(Math.max(DEFAULT_EXPIRY_MINUTES, 31), 24 * 60) * 60 * 1000

const isAppointmentPaid = (appointment) =>
    appointment.paymentStatus === 'paid' || appointment.payment === true

/**
 * Idempotency key for a given payment attempt. Concurrent retries reuse the SAME
 * active StripePayment row (row lock + unique active constraint), so they derive
 * the same key and Stripe returns the same session instead of a duplicate.
 * A fresh attempt (e.g. after expiry) is a new row -> new key -> new session.
 */
export const buildIdempotencyKey = (appointmentId, paymentId) =>
    `appointment_${appointmentId}_payment_${paymentId}`

const isExpired = (payment, now) =>
    payment.expiresAt instanceof Date && payment.expiresAt.getTime() <= now.getTime()

const markStripeCreationFailed = async ({ appointmentId, paymentId, error }) => {
    await withTransaction(async (transaction) => {
        // Lock order: appointment → payment (consistent with prepare / cancellation).
        const appointment = await Appointment.findByPk(appointmentId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        })
        const payment = await StripePayment.findByPk(paymentId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        })

        if (payment && ACTIVE_PAYMENT_STATUSES.includes(payment.status)) {
            await payment.update(
                {
                    status: PAYMENT_STATUS.FAILED,
                    activeAppointmentId: null,
                },
                { transaction }
            )
        }

        if (
            appointment &&
            appointment.status !== APPOINTMENT_STATUS.CANCELLED &&
            appointment.status !== APPOINTMENT_STATUS.COMPLETED &&
            appointment.status !== APPOINTMENT_STATUS.NO_SHOW &&
            !isAppointmentPaid(appointment) &&
            appointment.paymentStatus !== APPOINTMENT_PAYMENT_STATUS.PAID
        ) {
            await appointment.update(
                { paymentStatus: APPOINTMENT_PAYMENT_STATUS.PENDING_RETRY },
                { transaction }
            )
        }
    }, { operation: 'mark_stripe_creation_failed' })

    logPayment('error', 'Stripe checkout creation failed — appointment retained for retry', {
        appointmentId,
        paymentId,
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.PENDING_RETRY,
        error: error?.message || String(error),
    })
}

/**
 * Persist Stripe session details after the external API call succeeds.
 * Runs in its own transaction — never inside the Stripe HTTP call window.
 */
const saveCheckoutSession = async ({
    appointmentId,
    paymentId,
    session,
    expiresAt,
}) => {
    return withTransaction(async (transaction) => {
        // Lock order: appointment → payment. Re-validate terminal / retired state so a
        // cancel that committed between TX1 and Stripe cannot be overwritten here.
        const appointment = await Appointment.findByPk(appointmentId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        })
        const payment = await StripePayment.findByPk(paymentId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        })
        if (!payment) {
            throw new Error('Payment row missing after Stripe session create')
        }

        const appointmentTerminal =
            !appointment ||
            appointment.status === APPOINTMENT_STATUS.CANCELLED ||
            appointment.status === APPOINTMENT_STATUS.COMPLETED ||
            appointment.status === APPOINTMENT_STATUS.NO_SHOW

        if (appointmentTerminal || !ACTIVE_PAYMENT_STATUSES.includes(payment.status)) {
            logPayment('warn', 'checkout session discarded — appointment/payment no longer active', {
                appointmentId,
                paymentId,
                appointmentStatus: appointment?.status || null,
                paymentStatus: payment.status,
                sessionId: session.id,
            })
            if (ACTIVE_PAYMENT_STATUSES.includes(payment.status)) {
                await payment.update(
                    {
                        status: PAYMENT_STATUS.EXPIRED,
                        activeAppointmentId: null,
                        stripeCheckoutSessionId: session.id,
                        checkoutUrl: session.url,
                    },
                    { transaction }
                )
            }
            return {
                ok: false,
                code: 'appointment_not_found',
                message: 'Appointment Cancelled or not found',
                sessionId: session.id,
                paymentId: payment.id,
            }
        }

        await payment.update(
            {
                stripeCheckoutSessionId: session.id,
                checkoutUrl: session.url,
                status: PAYMENT_STATUS.CHECKOUT_CREATED,
                expiresAt: session.expires_at
                    ? new Date(session.expires_at * 1000)
                    : expiresAt,
            },
            { transaction }
        )

        await appointment.update(
            {
                paymentStatus: APPOINTMENT_PAYMENT_STATUS.PENDING,
                stripeCheckoutSessionId: session.id,
            },
            { transaction }
        )

        return {
            ok: true,
            existingPayment: false,
            sessionUrl: session.url,
            sessionId: session.id,
            paymentId: payment.id,
        }
    }, { operation: 'save_checkout_session' })
}

/**
 * Core payment-creation service shared by the direct booking flow (payMode=now)
 * and the standalone "Pay with Stripe" endpoint.
 *
 * Transaction boundaries:
 *   TX1 (DB only): lock appointment, validate, reuse or create StripePayment row
 *   AFTER COMMIT: create Stripe Checkout Session (external)
 *   TX2 (DB only): persist session URL / mark FAILED + pending_retry on failure
 *
 * Guarantees a single active Stripe Checkout Session per appointment.
 * Stripe failures never roll back the appointment — paymentStatus becomes pending_retry.
 *
 * @param {object} args
 * @param {string} args.appointmentId
 * @param {string} args.userId
 * @param {object} [deps] Injectable dependencies (used by tests).
 * @param {Function} [deps.createSession] Stripe session creator.
 * @param {Function} [deps.now] Clock.
 */
export const createAppointmentPayment = async (
    { appointmentId, userId },
    { createSession = createStripeCheckoutSession, now = () => new Date() } = {}
) => {
    const preparePayment = () =>
        withTransaction(async (transaction) => {
            const appointment = await Appointment.findByPk(appointmentId, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            })

            if (!appointment) {
                return { ok: false, code: 'appointment_not_found', message: 'Appointment Cancelled or not found' }
            }

            if (
                appointment.status === APPOINTMENT_STATUS.CANCELLED ||
                appointment.status === APPOINTMENT_STATUS.NO_SHOW ||
                appointment.status === APPOINTMENT_STATUS.COMPLETED
            ) {
                return { ok: false, code: 'appointment_not_found', message: 'Appointment Cancelled or not found' }
            }

            if (String(appointment.userId) !== String(userId)) {
                return { ok: false, code: 'unauthorized', message: 'Unauthorized action' }
            }

            if (isAppointmentPaid(appointment)) {
                return { ok: false, code: 'already_paid', message: 'Appointment already paid' }
            }

            const nowDate = now()

            const activePayment = await StripePayment.findOne({
                where: { appointmentId, status: ACTIVE_PAYMENT_STATUSES },
                transaction,
                lock: transaction.LOCK.UPDATE,
            })

            if (activePayment) {
                const expired = isExpired(activePayment, nowDate)
                if (!expired && activePayment.stripeCheckoutSessionId && activePayment.checkoutUrl) {
                    logPayment('info', 'existing active payment found — reusing checkout session', {
                        appointmentId,
                        paymentId: activePayment.id,
                        sessionId: activePayment.stripeCheckoutSessionId,
                    })
                    return {
                        ok: true,
                        existingPayment: true,
                        sessionUrl: activePayment.checkoutUrl,
                        sessionId: activePayment.stripeCheckoutSessionId,
                        paymentId: activePayment.id,
                    }
                }

                // CREATED without a session yet — reuse the row so concurrent callers
                // share the same idempotency key after commit.
                if (!expired && !activePayment.stripeCheckoutSessionId) {
                    const amount = getExpectedAmountCents(appointment)
                    const currency = getCurrency(appointment)
                    const expiresAt = new Date(nowDate.getTime() + EXPIRY_MS)
                    return {
                        ok: true,
                        needsStripe: true,
                        existingPayment: false,
                        appointmentId: appointment.id,
                        paymentId: activePayment.id,
                        amount,
                        currency,
                        expiresAt,
                        userId,
                    }
                }

                // Expired (or never reached Stripe) — retire it before creating a new one.
                await activePayment.update(
                    { status: PAYMENT_STATUS.EXPIRED, activeAppointmentId: null },
                    { transaction }
                )
                logPayment('info', 'previous checkout session expired — creating a new one', {
                    appointmentId,
                    paymentId: activePayment.id,
                    expiredSessionId: activePayment.stripeCheckoutSessionId,
                })
            }

            logPayment('info', 'payment creation started', { appointmentId, userId })

            const amount = getExpectedAmountCents(appointment)
            const currency = getCurrency(appointment)

            const payment = await StripePayment.create(
                {
                    appointmentId,
                    userId,
                    amount,
                    currency,
                    status: PAYMENT_STATUS.CREATED,
                },
                { transaction }
            )

            const expiresAt = new Date(nowDate.getTime() + EXPIRY_MS)

            return {
                ok: true,
                needsStripe: true,
                existingPayment: false,
                appointmentId: appointment.id,
                paymentId: payment.id,
                amount,
                currency,
                expiresAt,
                userId,
            }
        }, { operation: 'prepare_appointment_payment' })

    let prepared
    try {
        prepared = await preparePayment()
    } catch (error) {
        // Race backstop: unique active-payment index rejects a second insert.
        if (error.name === 'SequelizeUniqueConstraintError') {
            logPayment('warn', 'duplicate active payment prevented by unique constraint — retrying', {
                appointmentId,
            })
            prepared = await preparePayment()
        } else {
            throw error
        }
    }

    if (!prepared.ok || prepared.existingPayment || !prepared.needsStripe) {
        return prepared
    }

    // ── AFTER COMMIT: external Stripe call (cannot participate in DB rollback) ──
    const idempotencyKey = buildIdempotencyKey(prepared.appointmentId, prepared.paymentId)
    let session
    try {
        // Reload appointment outside the previous transaction for Stripe metadata.
        const appointment = await Appointment.findByPk(prepared.appointmentId)
        if (!appointment) {
            return { ok: false, code: 'appointment_not_found', message: 'Appointment Cancelled or not found' }
        }

        session = await createSession(appointment, userId, {
            idempotencyKey,
            expiresAt: prepared.expiresAt,
            paymentId: prepared.paymentId,
        })

        logPayment('info', 'new checkout session created with idempotency key', {
            appointmentId: prepared.appointmentId,
            paymentId: prepared.paymentId,
            sessionId: session.id,
            idempotencyKey,
        })
    } catch (error) {
        await markStripeCreationFailed({
            appointmentId: prepared.appointmentId,
            paymentId: prepared.paymentId,
            error,
        })
        return {
            ok: false,
            code: 'stripe_unavailable',
            message: error?.message || 'Stripe checkout unavailable',
            paymentStatus: APPOINTMENT_PAYMENT_STATUS.PENDING_RETRY,
            appointmentId: prepared.appointmentId,
            paymentId: prepared.paymentId,
            retryable: true,
        }
    }

    try {
        return await saveCheckoutSession({
            appointmentId: prepared.appointmentId,
            paymentId: prepared.paymentId,
            session,
            expiresAt: prepared.expiresAt,
        })
    } catch (error) {
        // Session may exist at Stripe but DB save failed — mark retryable; do not hide error.
        logPayment('error', 'failed to persist checkout session after Stripe success', {
            appointmentId: prepared.appointmentId,
            paymentId: prepared.paymentId,
            sessionId: session?.id,
            error: error.message,
        })
        await markStripeCreationFailed({
            appointmentId: prepared.appointmentId,
            paymentId: prepared.paymentId,
            error,
        }).catch((markError) => {
            logPayment('error', 'failed to mark payment failed after persist error', {
                appointmentId: prepared.appointmentId,
                error: markError.message,
            })
        })
        throw error
    }
}

/**
 * Read-only payment status for an appointment, including the active checkout URL
 * (if any) so the frontend can resume instead of creating payments blindly.
 */
export const getAppointmentPaymentStatus = async ({ appointmentId, userId }) => {
    const appointment = await Appointment.findByPk(appointmentId)

    if (!appointment) {
        return { ok: false, code: 'appointment_not_found', message: 'Appointment not found' }
    }

    if (String(appointment.userId) !== String(userId)) {
        return { ok: false, code: 'unauthorized', message: 'Unauthorized action' }
    }

    const paymentStatus =
        appointment.paymentStatus || (appointment.payment ? 'paid' : 'unpaid')

    const activePayment = await StripePayment.findOne({
        where: { appointmentId, status: ACTIVE_PAYMENT_STATUSES },
        order: [['createdAt', 'DESC']],
    })

    return {
        ok: true,
        appointmentId: appointment.id,
        paymentStatus,
        checkoutUrl: activePayment?.checkoutUrl || null,
        sessionId: activePayment?.stripeCheckoutSessionId || null,
    }
}
