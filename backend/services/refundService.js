import sequelize from '../config/mysql.js'
import Appointment from '../models/appointmentModel.js'
import StripePayment, {
  PAYMENT_STATUS,
  APPOINTMENT_PAYMENT_STATUS,
} from '../models/stripePaymentModel.js'
import RefundAudit, { REFUND_AUDIT_ACTION } from '../models/refundAuditModel.js'
import { getStripe } from './stripePaymentService.js'
import { claimWebhookEvent } from './stripePaymentService.js'

export class RefundError extends Error {
  constructor(message, { statusCode = 400, code = 'refund_error' } = {}) {
    super(message)
    this.name = 'RefundError'
    this.statusCode = statusCode
    this.code = code
  }
}

const logRefund = (level, message, meta = {}) => {
  const entry = {
    scope: 'refund',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

export const writeRefundAudit = async ({
  appointmentId,
  paymentTransactionId = null,
  action,
  amount = null,
  reason = null,
  performedBy,
  performedById = null,
  stripeRefundId = null,
  metadata = null,
  transaction,
}) => {
  return RefundAudit.create(
    {
      appointmentId,
      paymentTransactionId,
      action,
      amount,
      reason,
      performedBy,
      performedById,
      stripeRefundId,
      metadata,
    },
    { transaction }
  )
}

/**
 * Find the paid StripePayment for an appointment (most recent PAID / refund-in-flight).
 */
export const findPaidPayment = async (appointmentId, { transaction, lock = false } = {}) => {
  const options = {
    where: {
      appointmentId,
      status: [
        PAYMENT_STATUS.PAID,
        PAYMENT_STATUS.REFUND_PENDING,
        PAYMENT_STATUS.REFUNDED,
        PAYMENT_STATUS.REFUND_FAILED,
      ],
    },
    order: [['createdAt', 'DESC']],
    transaction,
  }
  if (lock && transaction) {
    options.lock = transaction.LOCK.UPDATE
  }
  return StripePayment.findOne(options)
}

export const verifyRefundEligibility = (payment) => {
  if (!payment) {
    throw new RefundError('No paid payment found for appointment', {
      statusCode: 400,
      code: 'payment_not_found',
    })
  }

  if (payment.status === PAYMENT_STATUS.REFUNDED) {
    throw new RefundError('Payment already refunded', {
      statusCode: 400,
      code: 'already_refunded',
    })
  }

  if (payment.status === PAYMENT_STATUS.REFUND_PENDING) {
    throw new RefundError('Refund already in progress', {
      statusCode: 409,
      code: 'refund_pending',
    })
  }

  if (payment.status !== PAYMENT_STATUS.PAID && payment.status !== PAYMENT_STATUS.REFUND_FAILED) {
    throw new RefundError(`Payment status ${payment.status} is not refundable`, {
      statusCode: 400,
      code: 'not_refundable',
    })
  }

  if (!payment.stripePaymentIntentId && !payment.stripeChargeId) {
    throw new RefundError('Payment is missing Stripe identifiers required for refund', {
      statusCode: 400,
      code: 'missing_stripe_ids',
    })
  }

  return true
}

/**
 * Create a Stripe refund for a locked PAID payment row.
 * Caller owns the transaction and must have already locked the payment.
 *
 * @returns {{ refund, payment }}
 */
export const processStripeRefund = async ({
  payment,
  appointment,
  amountCents,
  reason,
  actorType,
  actorId = null,
  auditAction = REFUND_AUDIT_ACTION.REFUND_CREATED,
  createRefundFn = null,
  transaction,
}) => {
  verifyRefundEligibility(payment)

  const refundAmount = Number.isFinite(amountCents) ? Math.round(amountCents) : payment.amount
  if (refundAmount <= 0) {
    throw new RefundError('Refund amount must be greater than zero', {
      statusCode: 400,
      code: 'invalid_refund_amount',
    })
  }
  if (refundAmount > payment.amount) {
    throw new RefundError('Refund amount exceeds original payment', {
      statusCode: 400,
      code: 'refund_amount_exceeds_payment',
    })
  }

  // Claim REFUND_PENDING before calling Stripe to block concurrent duplicates.
  await payment.update(
    {
      status: PAYMENT_STATUS.REFUND_PENDING,
      refundAmount,
      refundStatus: 'pending',
      refundReason: reason || null,
      activeAppointmentId: null,
    },
    { transaction }
  )

  await appointment.update(
    {
      paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
      // Keep payment=true until webhook confirms refunded — mirrors "money still held".
      payment: true,
    },
    { transaction }
  )

  const idempotencyKey = `refund_${payment.appointmentId}_${payment.id}_${refundAmount}`
  const params = {
    amount: refundAmount,
    reason: 'requested_by_customer',
    metadata: {
      appointmentId: String(appointment.id),
      paymentId: String(payment.id),
      actorType: String(actorType || ''),
    },
  }

  if (payment.stripePaymentIntentId) {
    params.payment_intent = payment.stripePaymentIntentId
  } else {
    params.charge = payment.stripeChargeId
  }

  let refund
  try {
    const createRefund =
      createRefundFn ||
      (async (p, opts) => {
        const stripe = getStripe()
        return stripe.refunds.create(p, opts)
      })

    // Stripe call outside DB lock would be safer for long waits, but we need
    // REFUND_PENDING claimed first. Keep the call inside the tx; tests inject createRefundFn.
    refund = await createRefund(params, { idempotencyKey })
  } catch (error) {
    await payment.update(
      {
        status: PAYMENT_STATUS.REFUND_FAILED,
        refundStatus: 'failed',
        refundReason: reason || error.message,
        activeAppointmentId: null,
      },
      { transaction }
    )
    await appointment.update(
      {
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_FAILED,
        payment: true,
      },
      { transaction }
    )

    await writeRefundAudit({
      appointmentId: appointment.id,
      paymentTransactionId: payment.id,
      action: REFUND_AUDIT_ACTION.REFUND_FAILED,
      amount: refundAmount,
      reason: reason || error.message,
      performedBy: actorType,
      performedById: actorId,
      metadata: { error: error.message, code: error.code || null },
      transaction,
    })

    logRefund('error', 'Stripe refund create failed', {
      appointmentId: appointment.id,
      paymentId: payment.id,
      paymentStatus: PAYMENT_STATUS.REFUND_FAILED,
      refundRequired: true,
      refundAmount,
      error: error.message,
    })

    throw new RefundError(error.message || 'Stripe refund failed', {
      statusCode: 502,
      code: 'stripe_refund_failed',
    })
  }

  const stripeStatus = refund.status || 'pending'
  const chargeId =
    typeof refund.charge === 'string' ? refund.charge : refund.charge?.id || payment.stripeChargeId

  const fields = {
    stripeRefundId: refund.id,
    refundAmount: refund.amount ?? refundAmount,
    refundStatus: stripeStatus,
    refundReason: reason || null,
    stripeChargeId: chargeId || payment.stripeChargeId,
    activeAppointmentId: null,
  }

  if (stripeStatus === 'succeeded') {
    fields.status = PAYMENT_STATUS.REFUNDED
    fields.refundedAt = new Date()
  } else if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
    fields.status = PAYMENT_STATUS.REFUND_FAILED
  } else {
    fields.status = PAYMENT_STATUS.REFUND_PENDING
  }

  await payment.update(fields, { transaction })

  if (fields.status === PAYMENT_STATUS.REFUNDED) {
    await appointment.update(
      {
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUNDED,
        payment: false,
      },
      { transaction }
    )
  } else if (fields.status === PAYMENT_STATUS.REFUND_FAILED) {
    await appointment.update(
      {
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_FAILED,
        payment: true,
      },
      { transaction }
    )
  }

  await writeRefundAudit({
    appointmentId: appointment.id,
    paymentTransactionId: payment.id,
    action: auditAction,
    amount: fields.refundAmount,
    reason,
    performedBy: actorType,
    performedById: actorId,
    stripeRefundId: refund.id,
    metadata: { stripeRefundStatus: stripeStatus },
    transaction,
  })

  if (fields.status === PAYMENT_STATUS.REFUNDED) {
    await writeRefundAudit({
      appointmentId: appointment.id,
      paymentTransactionId: payment.id,
      action: REFUND_AUDIT_ACTION.REFUND_SUCCEEDED,
      amount: fields.refundAmount,
      reason,
      performedBy: 'SYSTEM',
      stripeRefundId: refund.id,
      metadata: { source: 'refund_create_sync' },
      transaction,
    })
  }

  logRefund('info', 'Stripe refund created', {
    appointmentId: appointment.id,
    paymentId: payment.id,
    paymentStatus: fields.status,
    refundRequired: true,
    refundAmount: fields.refundAmount,
    stripeRefundId: refund.id,
    refundResult: stripeStatus,
  })

  await payment.reload({ transaction })
  return { refund, payment }
}

/**
 * High-level: refund a paid appointment payment (used by cancellation + support).
 */
export const refundAppointmentPayment = async ({
  appointmentId,
  amountCents,
  reason,
  actorType,
  actorId = null,
  auditAction,
  createRefundFn = null,
  transaction: outerTx = null,
}) => {
  const run = async (transaction) => {
    const appointment = await Appointment.findByPk(appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (!appointment) {
      throw new RefundError('Appointment not found', { statusCode: 404, code: 'not_found' })
    }

    const payment = await findPaidPayment(appointmentId, { transaction, lock: true })
    return processStripeRefund({
      payment,
      appointment,
      amountCents,
      reason,
      actorType,
      actorId,
      auditAction,
      createRefundFn,
      transaction,
    })
  }

  if (outerTx) return run(outerTx)

  return sequelize.transaction(async (transaction) => run(transaction))
}

/**
 * Webhook-driven refund status update.
 * Supports charge.refunded, refund.created, refund.updated.
 */
export const updateRefundStatus = async ({
  paymentIntentId = null,
  chargeId = null,
  refundId = null,
  refundStatus = null,
  amountRefunded = null,
  stripeEventId = null,
  eventType = null,
}) => {
  return sequelize.transaction(async (transaction) => {
    const claim = await claimWebhookEvent(stripeEventId, eventType, transaction)
    if (claim.duplicate) {
      return { status: 'duplicate', message: 'Event already processed' }
    }

    if (!paymentIntentId && !chargeId && !refundId) {
      return { status: 'ignored', message: 'Missing refund identifiers' }
    }

    let payment = null
    if (refundId) {
      payment = await StripePayment.findOne({
        where: { stripeRefundId: refundId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
    }
    if (!payment && paymentIntentId) {
      payment = await StripePayment.findOne({
        where: { stripePaymentIntentId: paymentIntentId },
        transaction,
        lock: transaction.LOCK.UPDATE,
        order: [['createdAt', 'DESC']],
      })
    }
    if (!payment && chargeId) {
      payment = await StripePayment.findOne({
        where: { stripeChargeId: chargeId },
        transaction,
        lock: transaction.LOCK.UPDATE,
        order: [['createdAt', 'DESC']],
      })
    }

    if (!payment) {
      logRefund('warn', 'refund event with no matching payment record', {
        paymentIntentId,
        chargeId,
        refundId,
        stripeEventId,
      })
      return { status: 'ignored', message: 'Payment record not found' }
    }

    const appointment = await Appointment.findByPk(payment.appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })

    const normalized = String(refundStatus || '').toLowerCase()
    const isFailed = normalized === 'failed' || normalized === 'canceled'
    const isSucceeded =
      normalized === 'succeeded' ||
      eventType === 'charge.refunded' ||
      (!normalized && amountRefunded != null)

    if (payment.status === PAYMENT_STATUS.REFUNDED && isSucceeded) {
      return {
        status: 'already_refunded',
        message: 'Payment already refunded',
        appointmentId: payment.appointmentId,
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUNDED,
        appointmentStatus: appointment?.status,
      }
    }

    if (isFailed) {
      await payment.update(
        {
          status: PAYMENT_STATUS.REFUND_FAILED,
          refundStatus: normalized || 'failed',
          stripeRefundId: refundId || payment.stripeRefundId,
          refundAmount: amountRefunded ?? payment.refundAmount,
          activeAppointmentId: null,
        },
        { transaction }
      )
      if (appointment) {
        await appointment.update(
          {
            paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_FAILED,
            payment: true,
          },
          { transaction }
        )
      }
      await writeRefundAudit({
        appointmentId: payment.appointmentId,
        paymentTransactionId: payment.id,
        action: REFUND_AUDIT_ACTION.REFUND_FAILED,
        amount: amountRefunded ?? payment.refundAmount,
        reason: `Webhook ${eventType}`,
        performedBy: 'SYSTEM',
        stripeRefundId: refundId || payment.stripeRefundId,
        metadata: { eventType, stripeEventId },
        transaction,
      })

      logRefund('warn', 'refund marked failed via webhook', {
        appointmentId: payment.appointmentId,
        paymentId: payment.id,
        stripeRefundId: refundId,
        eventType,
      })

      return {
        status: 'refund_failed',
        appointmentId: payment.appointmentId,
        appointmentStatus: appointment?.status,
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_FAILED,
      }
    }

    if (isSucceeded) {
      await payment.update(
        {
          status: PAYMENT_STATUS.REFUNDED,
          refundStatus: 'succeeded',
          stripeRefundId: refundId || payment.stripeRefundId,
          stripeChargeId: chargeId || payment.stripeChargeId,
          refundAmount: amountRefunded ?? payment.refundAmount ?? payment.amount,
          refundedAt: payment.refundedAt || new Date(),
          activeAppointmentId: null,
        },
        { transaction }
      )
      if (appointment) {
        await appointment.update(
          {
            paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUNDED,
            payment: false,
          },
          { transaction }
        )
      }
      await writeRefundAudit({
        appointmentId: payment.appointmentId,
        paymentTransactionId: payment.id,
        action: REFUND_AUDIT_ACTION.REFUND_SUCCEEDED,
        amount: amountRefunded ?? payment.refundAmount,
        reason: `Webhook ${eventType}`,
        performedBy: 'SYSTEM',
        stripeRefundId: refundId || payment.stripeRefundId,
        metadata: { eventType, stripeEventId },
        transaction,
      })

      logRefund('info', 'payment marked refunded via webhook', {
        appointmentId: payment.appointmentId,
        paymentId: payment.id,
        stripeEventId,
        eventType,
        amountRefunded,
        appointmentStatus: appointment?.status,
      })

      return {
        status: 'refunded',
        message: 'Payment refunded',
        appointmentId: payment.appointmentId,
        appointmentStatus: appointment?.status,
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUNDED,
      }
    }

    // Intermediate states (pending, requires_action)
    await payment.update(
      {
        status: PAYMENT_STATUS.REFUND_PENDING,
        refundStatus: normalized || 'pending',
        stripeRefundId: refundId || payment.stripeRefundId,
        stripeChargeId: chargeId || payment.stripeChargeId,
        refundAmount: amountRefunded ?? payment.refundAmount,
        activeAppointmentId: null,
      },
      { transaction }
    )
    if (appointment && appointment.paymentStatus !== APPOINTMENT_PAYMENT_STATUS.REFUNDED) {
      await appointment.update(
        {
          paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
          payment: true,
        },
        { transaction }
      )
    }

    return {
      status: 'refund_pending',
      appointmentId: payment.appointmentId,
      appointmentStatus: appointment?.status,
      paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
    }
  })
}
