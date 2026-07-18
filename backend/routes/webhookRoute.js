import express from 'express'
import { handleStripeWebhook } from '../controllers/stripeWebhookController.js'

const webhookRouter = express.Router()

// Raw body required for Stripe signature verification.
webhookRouter.post(
    '/stripe',
    express.raw({ type: 'application/json' }),
    handleStripeWebhook
)

export default webhookRouter
