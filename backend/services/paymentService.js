import sequelize from '../config/mysql.js'
import Appointment from '../models/appointmentModel.js'
import StripePayment, {
    PAYMENT_STATUS,
    ACTIVE_PAYMENT_STATUSES,
} from '../models/stripePaymentModel.js'
import {
    createStripeCheckoutSession,
    getCurrency,
    getExpectedAmountCents,
} from './stripePaymentService.js'

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

/**
 * Core payment-creation service shared by the direct booking flow (payMode=now)
 * and the standalone "Pay with Stripe" endpoint.
 *
 * Guarantees a single active Stripe Checkout Session per appointment:
 *   BEGIN
 *     lock appointment row (FOR UPDATE)
 *     reject if missing / cancelled / not owned / already paid
 *     reuse active non-expired StripePayment session if present
 *     otherwise create a StripePayment row + Stripe session (idempotency key)
 *   COMMIT
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
    const run = () =>
        sequelize.transaction(async (transaction) => {
            const appointment = await Appointment.findByPk(appointmentId, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            })

            if (!appointment || appointment.cancelled) {
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

                // Expired (or never reached Stripe) — retire it before creating a new one.
                // activeAppointmentId must be cleared explicitly: instance.update()
                // only persists the columns passed to it, bypassing the hook's write.
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
            const currency = getCurrency()

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

            const idempotencyKey = buildIdempotencyKey(appointmentId, payment.id)
            const expiresAt = new Date(nowDate.getTime() + EXPIRY_MS)

            const session = await createSession(appointment, userId, {
                idempotencyKey,
                expiresAt,
                paymentId: payment.id,
            })

            logPayment('info', 'new checkout session created with idempotency key', {
                appointmentId,
                paymentId: payment.id,
                sessionId: session.id,
                idempotencyKey,
            })

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

            // Keep the appointment row in sync for backward compatibility with
            // existing doctor/admin views and the webhook reconciliation path.
            await appointment.update(
                {
                    paymentStatus: 'pending',
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
        })

    try {
        return await run()
    } catch (error) {
        // Race backstop: if two requests slipped past the row lock (e.g. SQLite
        // without FOR UPDATE), the active-payment unique index rejects the second
        // insert. Retry once to return the winner's existing session.
        if (error.name === 'SequelizeUniqueConstraintError') {
            logPayment('warn', 'duplicate active payment prevented by unique constraint — retrying', {
                appointmentId,
            })
            return run()
        }
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
