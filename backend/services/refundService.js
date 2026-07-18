import Appointment from '../models/appointmentModel.js'
import { withTransaction } from '../utils/databaseTransaction.js'
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

const resolveRefundAmount = (payment, amountCents) => {
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
  return refundAmount
}

const buildStripeRefundParams = ({ payment, appointmentId, amountCents, actorType }) => {
  const params = {
    amount: amountCents,
    reason: 'requested_by_customer',
    metadata: {
      appointmentId: String(appointmentId),
      paymentId: String(payment.id),
      actorType: String(actorType || ''),
    },
  }
  if (payment.stripePaymentIntentId) {
    params.payment_intent = payment.stripePaymentIntentId
  } else {
    params.charge = payment.stripeChargeId
  }
  return params
}

const callStripeRefund = async ({
  payment,
  appointmentId,
  amountCents,
  actorType,
  createRefundFn = null,
}) => {
  const createRefund =
    createRefundFn ||
    (async (p, opts) => {
      const stripe = getStripe()
      return stripe.refunds.create(p, opts)
    })

  return createRefund(buildStripeRefundParams({ payment, appointmentId, amountCents, actorType }), {
    idempotencyKey: `refund_${appointmentId}_${payment.id}_${amountCents}`,
  })
}

/**
 * Phase 1 (DB only): lock appointment → payment, claim REFUND_PENDING.
 * Stripe is intentionally NOT called here.
 */
const claimRefundPending = async ({
  appointmentId,
  amountCents,
  reason,
}) => {
  return withTransaction(async (transaction) => {
    const appointment = await Appointment.findByPk(appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (!appointment) {
      throw new RefundError('Appointment not found', { statusCode: 404, code: 'not_found' })
    }

    const payment = await findPaidPayment(appointmentId, { transaction, lock: true })
    verifyRefundEligibility(payment)
    const refundAmount = resolveRefundAmount(payment, amountCents)

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

    await payment.reload({ transaction })
    return {
      appointmentId: appointment.id,
      payment: payment.toJSON(),
      refundAmount,
    }
  }, { operation: 'claim_refund_pending' })
}

/**
 * Persist Stripe refund failure after the claim transaction already committed.
 */
const recordRefundFailure = async ({
  appointmentId,
  paymentId,
  refundAmount,
  reason,
  actorType,
  actorId,
  error,
}) => {
  await withTransaction(async (transaction) => {
    // Lock order: appointment → payment (consistent with claim / cancellation).
    const appointment = await Appointment.findByPk(appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    const payment = await StripePayment.findByPk(paymentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })

    if (payment) {
      await payment.update(
        {
          status: PAYMENT_STATUS.REFUND_FAILED,
          refundStatus: 'failed',
          refundReason: reason || error.message,
          activeAppointmentId: null,
        },
        { transaction }
      )
    }
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
      appointmentId,
      paymentTransactionId: paymentId,
      action: REFUND_AUDIT_ACTION.REFUND_FAILED,
      amount: refundAmount,
      reason: reason || error.message,
      performedBy: actorType,
      performedById: actorId,
      metadata: { error: error.message, code: error.code || null, retryable: true },
      transaction,
    })
  }, { operation: 'record_refund_failure' })
}

/**
 * Reconcile Stripe's immediate refund response in a short DB-only transaction.
 */
const reconcileRefundCreate = async ({
  appointmentId,
  paymentId,
  refund,
  refundAmount,
  reason,
  actorType,
  actorId,
  auditAction = REFUND_AUDIT_ACTION.REFUND_CREATED,
}) => {
  return withTransaction(async (transaction) => {
    // Lock order: appointment → payment.
    const appointment = await Appointment.findByPk(appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    const payment = await StripePayment.findByPk(paymentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    if (!payment || !appointment) {
      throw new RefundError('Payment or appointment missing during refund reconcile', {
        statusCode: 500,
        code: 'refund_reconcile_missing',
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
      action:
        fields.status === PAYMENT_STATUS.REFUND_FAILED
          ? REFUND_AUDIT_ACTION.REFUND_FAILED
          : auditAction,
      amount: fields.refundAmount,
      reason,
      performedBy: actorType,
      performedById: actorId,
      stripeRefundId: refund.id,
      metadata: {
        stripeRefundStatus: stripeStatus,
        retryable: fields.status === PAYMENT_STATUS.REFUND_FAILED,
      },
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

    await payment.reload({ transaction })
    return { refund, payment, status: fields.status }
  }, { operation: 'reconcile_refund_create' })
}

/**
 * Service-owned refund flow:
 *   TX1 (DB): claim REFUND_PENDING
 *   AFTER COMMIT: Stripe refunds.create (external)
 *   TX2 (DB): reconcile success OR record retryable failure
 *
 * Does not accept a caller transaction — Stripe must never run inside an open DB tx.
 *
 * @returns {{ refund, payment }}
 */
export const processStripeRefund = async ({
  appointmentId,
  amountCents,
  reason,
  actorType,
  actorId = null,
  auditAction = REFUND_AUDIT_ACTION.REFUND_CREATED,
  createRefundFn = null,
}) => {
  const claimed = await claimRefundPending({
    appointmentId,
    amountCents,
    reason,
  })

  let refund
  try {
    // AFTER COMMIT: external Stripe call — cannot participate in DB rollback.
    refund = await callStripeRefund({
      payment: claimed.payment,
      appointmentId: claimed.appointmentId,
      amountCents: claimed.refundAmount,
      actorType,
      createRefundFn,
    })
  } catch (error) {
    await recordRefundFailure({
      appointmentId: claimed.appointmentId,
      paymentId: claimed.payment.id,
      refundAmount: claimed.refundAmount,
      reason,
      actorType,
      actorId,
      error,
    })

    logRefund('error', 'Stripe refund create failed after claim committed', {
      appointmentId: claimed.appointmentId,
      paymentId: claimed.payment.id,
      paymentStatus: PAYMENT_STATUS.REFUND_FAILED,
      refundRequired: true,
      refundAmount: claimed.refundAmount,
      error: error.message,
    })

    throw new RefundError(error.message || 'Stripe refund failed', {
      statusCode: 502,
      code: 'stripe_refund_failed',
    })
  }

  const reconciled = await reconcileRefundCreate({
    appointmentId: claimed.appointmentId,
    paymentId: claimed.payment.id,
    refund,
    refundAmount: claimed.refundAmount,
    reason,
    actorType,
    actorId,
    auditAction,
  })

  if (reconciled.status === PAYMENT_STATUS.REFUND_FAILED) {
    throw new RefundError('Stripe refund failed', {
      statusCode: 502,
      code: 'stripe_refund_failed',
    })
  }

  logRefund('info', 'Stripe refund created', {
    appointmentId: claimed.appointmentId,
    paymentId: claimed.payment.id,
    paymentStatus: reconciled.status,
    refundRequired: true,
    refundAmount: claimed.refundAmount,
    stripeRefundId: refund.id,
    refundResult: refund.status || null,
  })

  return { refund: reconciled.refund, payment: reconciled.payment }
}

/**
 * High-level: refund a paid appointment payment (support / standalone).
 * Always owns its own transaction phases — never joins a caller transaction.
 */
export const refundAppointmentPayment = async ({
  appointmentId,
  amountCents,
  reason,
  actorType,
  actorId = null,
  auditAction,
  createRefundFn = null,
}) => {
  return processStripeRefund({
    appointmentId,
    amountCents,
    reason,
    actorType,
    actorId,
    auditAction,
    createRefundFn,
  })
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
  // DB-only webhook reconciliation; returning status objects commits the claim.
  return withTransaction(async (transaction) => {
    const claim = await claimWebhookEvent(stripeEventId, eventType, transaction)
    if (claim.duplicate) {
      return { status: 'duplicate', message: 'Event already processed' }
    }

    if (!paymentIntentId && !chargeId && !refundId) {
      return { status: 'ignored', message: 'Missing refund identifiers' }
    }

    // Probe without row lock to discover appointmentId, then lock appointment → payment.
    let paymentProbe = null
    if (refundId) {
      paymentProbe = await StripePayment.findOne({
        where: { stripeRefundId: refundId },
        transaction,
      })
    }
    if (!paymentProbe && paymentIntentId) {
      paymentProbe = await StripePayment.findOne({
        where: { stripePaymentIntentId: paymentIntentId },
        transaction,
        order: [['createdAt', 'DESC']],
      })
    }
    if (!paymentProbe && chargeId) {
      paymentProbe = await StripePayment.findOne({
        where: { stripeChargeId: chargeId },
        transaction,
        order: [['createdAt', 'DESC']],
      })
    }

    if (!paymentProbe) {
      logRefund('warn', 'refund event with no matching payment record', {
        paymentIntentId,
        chargeId,
        refundId,
        stripeEventId,
      })
      return { status: 'ignored', message: 'Payment record not found' }
    }

    const appointment = await Appointment.findByPk(paymentProbe.appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
    const payment = await StripePayment.findByPk(paymentProbe.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })

    if (!payment) {
      return { status: 'ignored', message: 'Payment record not found' }
    }

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
  }, { operation: 'update_refund_status' })
}
