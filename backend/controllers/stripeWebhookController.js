import { getStripe } from '../services/stripePaymentService.js'
import {
    markAppointmentPaidFromCheckoutSession,
    handleCheckoutSessionExpired,
    handleAsyncPaymentFailed,
} from '../services/stripePaymentService.js'

const logWebhook = (level, message, meta = {}) => {
    const payload = { service: 'stripeWebhook', ...meta }
    if (level === 'error') {
        console.error(`[stripe-webhook] ${message}`, payload)
    } else if (level === 'warn') {
        console.warn(`[stripe-webhook] ${message}`, payload)
    } else {
        console.log(`[stripe-webhook] ${message}`, payload)
    }
}

/**
 * POST /api/webhooks/stripe
 * Authenticates via Stripe signature only (no JWT).
 * Requires raw Buffer body (express.raw) for constructEvent.
 */
export const handleStripeWebhook = async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
        logWebhook('error', 'STRIPE_WEBHOOK_SECRET not configured')
        return res.status(500).json({ success: false, message: 'Webhook not configured' })
    }

    const signature = req.headers['stripe-signature']
    if (!signature) {
        logWebhook('warn', 'missing stripe-signature header')
        return res.status(400).json({ success: false, message: 'Missing Stripe signature' })
    }

    let event
    try {
        const stripe = getStripe()
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
    } catch (error) {
        logWebhook('warn', 'invalid webhook signature', { error: error.message })
        return res.status(400).json({ success: false, message: 'Invalid Stripe signature' })
    }

    logWebhook('info', 'event received', {
        eventId: event.id,
        eventType: event.type,
    })

    try {
        switch (event.type) {
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded': {
                const session = event.data.object
                logWebhook('info', 'processing checkout payment event', {
                    eventId: event.id,
                    eventType: event.type,
                    sessionId: session.id,
                    appointmentId: session.metadata?.appointmentId,
                    paymentStatus: session.payment_status,
                })

                const result = await markAppointmentPaidFromCheckoutSession({
                    session,
                    stripeEventId: event.id,
                    eventType: event.type,
                })

                logWebhook('info', 'payment reconciliation result', {
                    eventId: event.id,
                    eventType: event.type,
                    sessionId: session.id,
                    result: result.status,
                    appointmentId: result.appointmentId,
                    code: result.code,
                })
                break
            }

            case 'checkout.session.expired': {
                const session = event.data.object
                const result = await handleCheckoutSessionExpired({
                    session,
                    stripeEventId: event.id,
                    eventType: event.type,
                })
                logWebhook('info', 'expired session handled', {
                    eventId: event.id,
                    sessionId: session.id,
                    result: result.status,
                })
                break
            }

            case 'checkout.session.async_payment_failed': {
                const session = event.data.object
                const result = await handleAsyncPaymentFailed({
                    session,
                    stripeEventId: event.id,
                    eventType: event.type,
                })
                logWebhook('info', 'async payment failed handled', {
                    eventId: event.id,
                    sessionId: session.id,
                    result: result.status,
                })
                break
            }

            case 'payment_intent.payment_failed': {
                logWebhook('info', 'payment_intent.payment_failed acknowledged', {
                    eventId: event.id,
                    paymentIntentId: event.data.object?.id,
                })
                // Card Checkout is usually synchronous; acknowledge without mutating paid state.
                break
            }

            default:
                logWebhook('info', 'unhandled event type acknowledged', {
                    eventId: event.id,
                    eventType: event.type,
                })
        }

        return res.status(200).json({ received: true })
    } catch (error) {
        logWebhook('error', 'processing failure', {
            eventId: event?.id,
            eventType: event?.type,
            error: error.message,
        })
        // Return 500 so Stripe retries transient failures.
        return res.status(500).json({ success: false, message: 'Webhook processing failed' })
    }
}
