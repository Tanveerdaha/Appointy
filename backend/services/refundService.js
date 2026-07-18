import Appointment from '../models/appointmentModel.js'
import { withTransaction } from '../utils/databaseTransaction.js'
import StripePayment, {
  PAYMENT_STATUS,
  APPOINTMENT_PAYMENT_STATUS,
} from '../models/stripePaymentModel.js'
import RefundAudit, { REFUND_AUDIT_ACTION } from '../models/refundAuditModel.js'
import { getStripe } from './stripePaymentService.js'
import { claimWebhookEvent } from './stripePaymentService.js'
import { sendEmail } from './notificationService.js'
import { Op } from 'sequelize'

export class RefundError extends Error {
  constructor(message, { statusCode = 400, code = 'refund_error' } = {}) {
    super(message)
    this.name = 'RefundError'
    this.statusCode = statusCode
    this.code = code
  }
}

/** Max automated retry attempts before requiring admin force. */
export const MAX_REFUND_AUTO_RETRIES = 5

/** Backoff after failure when refundRetryCount is 0, 1, 2, 3, 4. */
export const REFUND_RETRY_BACKOFF_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
]

/** REFUND_PENDING older than this is eligible for worker resume. */
export const STALE_REFUND_PENDING_MS = 15 * 60 * 1000

export const computeRefundNextRetryAt = (retryCount) => {
  const count = Number(retryCount) || 0
  if (count >= MAX_REFUND_AUTO_RETRIES) return null
  const delay =
    REFUND_RETRY_BACKOFF_MS[Math.min(count, REFUND_RETRY_BACKOFF_MS.length - 1)]
  return new Date(Date.now() + delay)
}

/**
 * Fields to persist when marking a payment REFUND_FAILED (does not bump retryCount).
 */
export const buildRefundFailedFields = (payment, { errorMessage, reason } = {}) => {
  const retryCount = Number(payment?.refundRetryCount) || 0
  const exhausted = retryCount >= MAX_REFUND_AUTO_RETRIES
  const errText = String(errorMessage || reason || 'refund failed').slice(0, 512)
  return {
    status: PAYMENT_STATUS.REFUND_FAILED,
    refundStatus: 'failed',
    refundReason: reason || payment?.refundReason || errText,
    refundLastError: errText,
    refundNextRetryAt: exhausted ? null : computeRefundNextRetryAt(retryCount),
    activeAppointmentId: null,
  }
}

export const isRefundRetryExhausted = (payment) =>
  (Number(payment?.refundRetryCount) || 0) >= MAX_REFUND_AUTO_RETRIES

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

export const alertRefundFailure = async ({
  appointmentId,
  paymentId,
  errorMessage,
  exhausted = false,
}) => {
  const subject = exhausted
    ? `[Appointy] Refund retries exhausted — ${appointmentId}`
    : `[Appointy] Refund failed — ${appointmentId}`
  const text = [
    exhausted
      ? 'Automated refund retries have been exhausted. Admin force retry required.'
      : 'A payment refund failed and is scheduled for automated retry.',
    `appointmentId=${appointmentId}`,
    `paymentId=${paymentId}`,
    `error=${errorMessage || 'unknown'}`,
  ].join('\n')

  logRefund('error', exhausted ? 'refund_retry_exhausted' : 'refund_failed_alert', {
    appointmentId,
    paymentId,
    exhausted,
    error: errorMessage,
  })

  try {
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject,
      text,
      html: `<p>${text.replace(/\n/g, '<br/>')}</p>`,
    })
  } catch (error) {
    logRefund('warn', 'Failed to send refund alert email', {
      appointmentId,
      paymentId,
      error: error.message,
    })
  }
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
  attemptNumber = null,
}) => {
  const createRefund =
    createRefundFn ||
    (async (p, opts) => {
      const stripe = getStripe()
      return stripe.refunds.create(p, opts)
    })

  const baseKey = `refund_${appointmentId}_${payment.id}_${amountCents}`
  const idempotencyKey =
    attemptNumber != null && attemptNumber > 0
      ? `${baseKey}_r${attemptNumber}`
      : baseKey

  return createRefund(buildStripeRefundParams({ payment, appointmentId, amountCents, actorType }), {
    idempotencyKey,
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
  let exhausted = false
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
      const fields = buildRefundFailedFields(payment, {
        errorMessage: error?.message,
        reason: reason || error?.message,
      })
      await payment.update(fields, { transaction })
      exhausted = isRefundRetryExhausted({ refundRetryCount: payment.refundRetryCount })
      if (exhausted) {
        await writeRefundAudit({
          appointmentId,
          paymentTransactionId: paymentId,
          action: REFUND_AUDIT_ACTION.REFUND_RETRY_EXHAUSTED,
          amount: refundAmount,
          reason: fields.refundLastError,
          performedBy: actorType,
          performedById: actorId,
          metadata: { refundRetryCount: payment.refundRetryCount },
          transaction,
        })
      }
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
      metadata: {
        error: error.message,
        code: error.code || null,
        retryable: !exhausted,
      },
      transaction,
    })
  }, { operation: 'record_refund_failure' })

  if (exhausted) {
    await alertRefundFailure({
      appointmentId,
      paymentId,
      errorMessage: error?.message,
      exhausted: true,
    })
  }

  return { exhausted }
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
      fields.refundNextRetryAt = null
      fields.refundLastError = null
    } else if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
      Object.assign(
        fields,
        buildRefundFailedFields(payment, {
          errorMessage: `Stripe refund ${stripeStatus}`,
          reason: reason || `Stripe refund ${stripeStatus}`,
        })
      )
      // Preserve stripe refund identifiers from the create response.
      fields.stripeRefundId = refund.id
      fields.refundAmount = refund.amount ?? refundAmount
      fields.refundStatus = stripeStatus
      fields.refundReason = reason || null
      fields.stripeChargeId = chargeId || payment.stripeChargeId
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

    const exhausted =
      fields.status === PAYMENT_STATUS.REFUND_FAILED && isRefundRetryExhausted(payment)

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
        retryable: fields.status === PAYMENT_STATUS.REFUND_FAILED && !exhausted,
      },
      transaction,
    })

    if (exhausted) {
      await writeRefundAudit({
        appointmentId: appointment.id,
        paymentTransactionId: payment.id,
        action: REFUND_AUDIT_ACTION.REFUND_RETRY_EXHAUSTED,
        amount: fields.refundAmount,
        reason: fields.refundLastError,
        performedBy: actorType,
        performedById: actorId,
        stripeRefundId: refund.id,
        metadata: { refundRetryCount: payment.refundRetryCount },
        transaction,
      })
    }

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
    return { refund, payment, status: fields.status, exhausted }
  }, { operation: 'reconcile_refund_create' })
}

/**
 * After REFUND_PENDING is already claimed: Stripe create + DB reconcile.
 * Used by processStripeRefund and by late-payment crash recovery.
 */
const completeRefundAfterClaim = async ({
  appointmentId,
  payment,
  refundAmount,
  reason,
  actorType,
  actorId = null,
  auditAction = REFUND_AUDIT_ACTION.REFUND_CREATED,
  createRefundFn = null,
  attemptNumber = null,
}) => {
  let refund
  try {
    // AFTER COMMIT: external Stripe call — cannot participate in DB rollback.
    refund = await callStripeRefund({
      payment,
      appointmentId,
      amountCents: refundAmount,
      actorType,
      createRefundFn,
      attemptNumber,
    })
  } catch (error) {
    await recordRefundFailure({
      appointmentId,
      paymentId: payment.id,
      refundAmount,
      reason,
      actorType,
      actorId,
      error,
    })

    logRefund('error', 'Stripe refund create failed after claim committed', {
      appointmentId,
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

  const reconciled = await reconcileRefundCreate({
    appointmentId,
    paymentId: payment.id,
    refund,
    refundAmount,
    reason,
    actorType,
    actorId,
    auditAction,
  })

  if (reconciled.exhausted) {
    await alertRefundFailure({
      appointmentId,
      paymentId: payment.id,
      errorMessage: `Stripe refund ${refund.status}`,
      exhausted: true,
    })
  }

  if (reconciled.status === PAYMENT_STATUS.REFUND_FAILED) {
    throw new RefundError('Stripe refund failed', {
      statusCode: 502,
      code: 'stripe_refund_failed',
    })
  }

  logRefund('info', 'Stripe refund created', {
    appointmentId,
    paymentId: payment.id,
    paymentStatus: reconciled.status,
    refundRequired: true,
    refundAmount,
    stripeRefundId: refund.id,
    refundResult: refund.status || null,
  })

  return { refund: reconciled.refund, payment: reconciled.payment }
}

/**
 * Resume Stripe refund create + reconcile when REFUND_PENDING was already claimed
 * (e.g. crash after claim, before Stripe returned). Uses the same idempotency key.
 */
export const resumeRefundAfterClaim = async ({
  appointmentId,
  amountCents = null,
  reason = null,
  actorType,
  actorId = null,
  auditAction = REFUND_AUDIT_ACTION.REFUND_CREATED,
  createRefundFn = null,
  payment: paymentArg = null,
}) => {
  const payment =
    paymentArg ||
    (await findPaidPayment(appointmentId))

  if (!payment || payment.status !== PAYMENT_STATUS.REFUND_PENDING) {
    throw new RefundError('No pending refund to resume', {
      statusCode: 409,
      code: 'not_refund_pending',
    })
  }

  const paymentPlain = typeof payment.toJSON === 'function' ? payment.toJSON() : payment
  const refundAmount = resolveRefundAmount(
    paymentPlain,
    amountCents ?? paymentPlain.refundAmount ?? paymentPlain.amount
  )

  return completeRefundAfterClaim({
    appointmentId,
    payment: paymentPlain,
    refundAmount,
    reason: reason || paymentPlain.refundReason,
    actorType,
    actorId,
    auditAction,
    createRefundFn,
  })
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

  return completeRefundAfterClaim({
    appointmentId: claimed.appointmentId,
    payment: claimed.payment,
    refundAmount: claimed.refundAmount,
    reason,
    actorType,
    actorId,
    auditAction,
    createRefundFn,
  })
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
      const failedFields = buildRefundFailedFields(payment, {
        errorMessage: `Webhook ${eventType}: ${normalized}`,
        reason: `Webhook ${eventType}`,
      })
      await payment.update(
        {
          ...failedFields,
          stripeRefundId: refundId || payment.stripeRefundId,
          refundAmount: amountRefunded ?? payment.refundAmount,
          refundStatus: normalized || 'failed',
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
      const exhausted = isRefundRetryExhausted(payment)
      await writeRefundAudit({
        appointmentId: payment.appointmentId,
        paymentTransactionId: payment.id,
        action: REFUND_AUDIT_ACTION.REFUND_FAILED,
        amount: amountRefunded ?? payment.refundAmount,
        reason: `Webhook ${eventType}`,
        performedBy: 'SYSTEM',
        stripeRefundId: refundId || payment.stripeRefundId,
        metadata: { eventType, stripeEventId, retryable: !exhausted },
        transaction,
      })
      if (exhausted) {
        await writeRefundAudit({
          appointmentId: payment.appointmentId,
          paymentTransactionId: payment.id,
          action: REFUND_AUDIT_ACTION.REFUND_RETRY_EXHAUSTED,
          amount: amountRefunded ?? payment.refundAmount,
          reason: failedFields.refundLastError,
          performedBy: 'SYSTEM',
          stripeRefundId: refundId || payment.stripeRefundId,
          metadata: { eventType, stripeEventId, refundRetryCount: payment.refundRetryCount },
          transaction,
        })
      }

      logRefund('warn', 'refund marked failed via webhook', {
        appointmentId: payment.appointmentId,
        paymentId: payment.id,
        stripeRefundId: refundId,
        eventType,
        exhausted,
      })

      // Alert after commit — schedule via return flag handled below is awkward inside tx.
      // Fire-and-forget after transaction by returning exhausted; caller doesn't alert.
      // Defer: mark on payment and alert outside via setImmediate after withTransaction returns.
      if (exhausted) {
        setImmediate(() => {
          alertRefundFailure({
            appointmentId: payment.appointmentId,
            paymentId: payment.id,
            errorMessage: failedFields.refundLastError,
            exhausted: true,
          }).catch(() => {})
        })
      }

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

const isUsableStripeRefund = (refund) => {
  const status = String(refund?.status || '').toLowerCase()
  return status === 'succeeded' || status === 'pending' || status === 'requires_action'
}

const applyStripeRefundLocally = async ({
  appointmentId,
  paymentId,
  refund,
  reason,
  actorType,
  actorId,
}) => {
  const reconciled = await reconcileRefundCreate({
    appointmentId,
    paymentId,
    refund,
    refundAmount: refund.amount,
    reason,
    actorType,
    actorId,
    auditAction: REFUND_AUDIT_ACTION.REFUND_RECONCILED,
  })

  if (reconciled.exhausted) {
    await alertRefundFailure({
      appointmentId,
      paymentId,
      errorMessage: `Stripe refund ${refund.status}`,
      exhausted: true,
    })
  }

  return {
    outcome: 'reconciled',
    refund: reconciled.refund,
    payment: reconciled.payment,
    paymentStatus: reconciled.payment?.paymentStatus || reconciled.status,
    ledgerStatus: reconciled.status,
  }
}

const retrieveStripeRefund = async (refundId, { retrieveRefundFn = null } = {}) => {
  if (retrieveRefundFn) return retrieveRefundFn(refundId)
  const stripe = getStripe()
  return stripe.refunds.retrieve(refundId)
}

const listStripeRefundsForPayment = async (payment, { listRefundsFn = null } = {}) => {
  if (listRefundsFn) return listRefundsFn(payment)
  const stripe = getStripe()
  const params = { limit: 20 }
  if (payment.stripePaymentIntentId) {
    params.payment_intent = payment.stripePaymentIntentId
  } else if (payment.stripeChargeId) {
    params.charge = payment.stripeChargeId
  } else {
    return []
  }
  const result = await stripe.refunds.list(params)
  return result?.data || []
}

/**
 * Claim REFUND_FAILED → REFUND_PENDING for a retry attempt, bumping refundRetryCount.
 */
const claimRefundRetry = async ({
  appointmentId,
  actorType,
  actorId,
  force = false,
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

    if (payment.status !== PAYMENT_STATUS.REFUND_FAILED) {
      throw new RefundError(`Payment status ${payment.status} is not retryable`, {
        statusCode: 400,
        code: 'not_refund_failed',
      })
    }

    if (!force) {
      if (isRefundRetryExhausted(payment)) {
        throw new RefundError('Refund retries exhausted — admin force required', {
          statusCode: 409,
          code: 'refund_retry_exhausted',
        })
      }
      if (payment.refundNextRetryAt && new Date(payment.refundNextRetryAt) > new Date()) {
        throw new RefundError('Refund retry not due yet', {
          statusCode: 409,
          code: 'refund_retry_not_due',
        })
      }
    }

    const refundAmount = resolveRefundAmount(
      payment,
      payment.refundAmount ?? payment.amount
    )
    const nextCount = (Number(payment.refundRetryCount) || 0) + 1

    await payment.update(
      {
        status: PAYMENT_STATUS.REFUND_PENDING,
        refundAmount,
        refundStatus: 'pending',
        refundRetryCount: nextCount,
        refundNextRetryAt: null,
        // Clear failed refund id so a replacement create can store a new unique id.
        stripeRefundId: null,
        activeAppointmentId: null,
      },
      { transaction }
    )

    await appointment.update(
      {
        paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
        payment: true,
      },
      { transaction }
    )

    await writeRefundAudit({
      appointmentId: appointment.id,
      paymentTransactionId: payment.id,
      action: REFUND_AUDIT_ACTION.REFUND_RETRY_REQUESTED,
      amount: refundAmount,
      reason: payment.refundReason,
      performedBy: actorType,
      performedById: actorId,
      metadata: {
        force: Boolean(force),
        refundRetryCount: nextCount,
      },
      transaction,
    })

    await payment.reload({ transaction })
    return {
      appointmentId: appointment.id,
      payment: payment.toJSON(),
      refundAmount,
      attemptNumber: nextCount,
      reason: payment.refundReason,
    }
  }, { operation: 'claim_refund_retry' })
}

/**
 * Idempotent retry / reconcile for REFUND_FAILED (and worker resume of stale REFUND_PENDING).
 * Does not cancel appointments — recovery is payment-only.
 */
export const retryOrReconcileFailedRefund = async ({
  appointmentId,
  actorType,
  actorId = null,
  force = false,
  createRefundFn = null,
  retrieveRefundFn = null,
  listRefundsFn = null,
  allowStalePending = false,
}) => {
  const payment = await findPaidPayment(appointmentId)
  if (!payment) {
    throw new RefundError('No paid payment found for appointment', {
      statusCode: 400,
      code: 'payment_not_found',
    })
  }

  if (payment.status === PAYMENT_STATUS.REFUNDED) {
    const appointment = await Appointment.findByPk(appointmentId)
    return {
      outcome: 'already_refunded',
      message: 'Payment already refunded',
      payment,
      appointment,
      paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUNDED,
      appointmentStatus: appointment?.status,
    }
  }

  if (payment.status === PAYMENT_STATUS.REFUND_PENDING) {
    if (!allowStalePending) {
      throw new RefundError('Refund already in progress', {
        statusCode: 409,
        code: 'refund_pending',
      })
    }
    const ageMs = Date.now() - new Date(payment.updatedAt || payment.createdAt).getTime()
    if (ageMs < STALE_REFUND_PENDING_MS && !force) {
      throw new RefundError('Refund already in progress', {
        statusCode: 409,
        code: 'refund_pending',
      })
    }

    const result = await resumeRefundAfterClaim({
      appointmentId,
      amountCents: payment.refundAmount || payment.amount,
      reason: payment.refundReason,
      actorType,
      actorId,
      createRefundFn,
      payment,
      // Resume uses base idempotency key (attemptNumber null) — first claim may not have completed Stripe.
    })
    const appointment = await Appointment.findByPk(appointmentId)
    return {
      outcome: 'resumed',
      message: 'Stale pending refund resumed',
      refund: result.refund,
      payment: result.payment,
      appointment,
      paymentStatus: result.payment?.status === PAYMENT_STATUS.REFUNDED
        ? APPOINTMENT_PAYMENT_STATUS.REFUNDED
        : APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
      appointmentStatus: appointment?.status,
    }
  }

  if (payment.status !== PAYMENT_STATUS.REFUND_FAILED) {
    throw new RefundError(`Payment status ${payment.status} is not retryable`, {
      statusCode: 400,
      code: 'not_refund_failed',
    })
  }

  const reason = payment.refundReason || 'Refund retry'
  const refundAmount = payment.refundAmount || payment.amount

  // Reconcile-first: retrieve known Stripe refund if present.
  if (payment.stripeRefundId) {
    try {
      const remote = await retrieveStripeRefund(payment.stripeRefundId, { retrieveRefundFn })
      if (isUsableStripeRefund(remote)) {
        const applied = await applyStripeRefundLocally({
          appointmentId,
          paymentId: payment.id,
          refund: remote,
          reason,
          actorType,
          actorId,
        })
        const appointment = await Appointment.findByPk(appointmentId)
        return {
          ...applied,
          message: 'Local state reconciled from Stripe refund',
          appointment,
          paymentStatus:
            applied.ledgerStatus === PAYMENT_STATUS.REFUNDED
              ? APPOINTMENT_PAYMENT_STATUS.REFUNDED
              : APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
          appointmentStatus: appointment?.status,
        }
      }
      // failed/canceled — fall through to list / replacement create
    } catch (error) {
      logRefund('warn', 'Failed to retrieve stripe refund during retry — will list/create', {
        appointmentId,
        paymentId: payment.id,
        stripeRefundId: payment.stripeRefundId,
        error: error.message,
      })
    }
  }

  // List refunds for lost-response recovery (no usable stored refund id).
  try {
    const listed = await listStripeRefundsForPayment(payment, { listRefundsFn })
    const match = (listed || []).find(
      (r) =>
        isUsableStripeRefund(r) &&
        (r.amount == null || Number(r.amount) === Number(refundAmount))
    )
    if (match) {
      const applied = await applyStripeRefundLocally({
        appointmentId,
        paymentId: payment.id,
        refund: match,
        reason,
        actorType,
        actorId,
      })
      const appointment = await Appointment.findByPk(appointmentId)
      return {
        ...applied,
        message: 'Local state reconciled from listed Stripe refund',
        appointment,
        paymentStatus:
          applied.ledgerStatus === PAYMENT_STATUS.REFUNDED
            ? APPOINTMENT_PAYMENT_STATUS.REFUNDED
            : APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
        appointmentStatus: appointment?.status,
      }
    }
  } catch (error) {
    logRefund('warn', 'Failed to list stripe refunds during retry — will create', {
      appointmentId,
      paymentId: payment.id,
      error: error.message,
    })
  }

  // Replacement create with attempt-scoped idempotency key.
  const claimed = await claimRefundRetry({
    appointmentId,
    actorType,
    actorId,
    force,
  })

  // Stripe metadata actorType: use SYSTEM for stable retry params across admin/worker.
  const stripeActorType = 'SYSTEM'

  const result = await completeRefundAfterClaim({
    appointmentId: claimed.appointmentId,
    payment: claimed.payment,
    refundAmount: claimed.refundAmount,
    reason: claimed.reason || reason,
    actorType: stripeActorType,
    actorId,
    auditAction: REFUND_AUDIT_ACTION.REFUND_CREATED,
    createRefundFn,
    attemptNumber: claimed.attemptNumber,
  })

  const appointment = await Appointment.findByPk(appointmentId)
  return {
    outcome: 'retried',
    message: 'Refund retry submitted',
    refund: result.refund,
    payment: result.payment,
    appointment,
    paymentStatus:
      result.payment?.status === PAYMENT_STATUS.REFUNDED
        ? APPOINTMENT_PAYMENT_STATUS.REFUNDED
        : result.payment?.status === PAYMENT_STATUS.REFUND_PENDING
          ? APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING
          : APPOINTMENT_PAYMENT_STATUS.REFUND_FAILED,
    appointmentStatus: appointment?.status,
  }
}

/**
 * Find payments due for automated refund retry / stale pending resume.
 */
export const findDueRefundRetries = async ({ limit = 10 } = {}) => {
  const now = new Date()
  const staleBefore = new Date(Date.now() - STALE_REFUND_PENDING_MS)

  const failed = await StripePayment.findAll({
    where: {
      status: PAYMENT_STATUS.REFUND_FAILED,
      refundNextRetryAt: { [Op.lte]: now },
      refundRetryCount: { [Op.lt]: MAX_REFUND_AUTO_RETRIES },
    },
    order: [['refundNextRetryAt', 'ASC']],
    limit,
  })

  const remaining = Math.max(0, limit - failed.length)
  let pending = []
  if (remaining > 0) {
    pending = await StripePayment.findAll({
      where: {
        status: PAYMENT_STATUS.REFUND_PENDING,
        updatedAt: { [Op.lte]: staleBefore },
      },
      order: [['updatedAt', 'ASC']],
      limit: remaining,
    })
  }

  return [...failed, ...pending]
}

