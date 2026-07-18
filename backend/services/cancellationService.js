import Appointment from '../models/appointmentModel.js'
import { withTransaction } from '../utils/databaseTransaction.js'
import StripePayment, {
  PAYMENT_STATUS,
  ACTIVE_PAYMENT_STATUSES,
  APPOINTMENT_PAYMENT_STATUS,
} from '../models/stripePaymentModel.js'
import { REFUND_AUDIT_ACTION } from '../models/refundAuditModel.js'
import {
  APPOINTMENT_STATUS,
  ACTOR_TYPE,
  cancelAppointment as cancelAppointmentLifecycle,
  LifecycleError,
  isTerminalStatus,
} from './appointmentStateService.js'
import { calculateRefundEligibility } from './refundPolicyService.js'
import {
  RefundError,
  findPaidPayment,
  processStripeRefund,
  writeRefundAudit,
} from './refundService.js'
import { getStripe } from './stripePaymentService.js'

export class CancellationError extends Error {
  constructor(message, { statusCode = 400, code = 'cancellation_error' } = {}) {
    super(message)
    this.name = 'CancellationError'
    this.statusCode = statusCode
    this.code = code
  }
}

const logCancellation = (level, message, meta = {}) => {
  const entry = {
    scope: 'cancellation',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

const normalizePaymentStatus = (appointment) => {
  const status = String(appointment.paymentStatus || '').toLowerCase()
  if (status) return status
  return appointment.payment ? APPOINTMENT_PAYMENT_STATUS.PAID : APPOINTMENT_PAYMENT_STATUS.UNPAID
}

const actorAuditAction = (actorType) => {
  switch (actorType) {
    case ACTOR_TYPE.DOCTOR:
      return REFUND_AUDIT_ACTION.DOCTOR_UNAVAILABLE
    case ACTOR_TYPE.ADMIN:
      return REFUND_AUDIT_ACTION.ADMIN_CANCELLED
    case ACTOR_TYPE.SYSTEM:
      return REFUND_AUDIT_ACTION.AUTO_CANCELLED
    default:
      return REFUND_AUDIT_ACTION.PATIENT_REQUESTED
  }
}

const defaultReason = (actorType) => {
  switch (actorType) {
    case ACTOR_TYPE.DOCTOR:
      return 'Cancelled by doctor (unavailable)'
    case ACTOR_TYPE.ADMIN:
      return 'Cancelled by admin'
    case ACTOR_TYPE.SYSTEM:
      return 'Automatically cancelled'
    default:
      return 'Cancelled by patient'
  }
}

/**
 * Retire any in-flight unpaid Checkout attempts for this appointment (DB only).
 * Returns Stripe session IDs that should be expired AFTER the surrounding transaction commits.
 */
const retireActivePayments = async (appointment, { transaction } = {}) => {
  const active = await StripePayment.findAll({
    where: {
      appointmentId: appointment.id,
      status: ACTIVE_PAYMENT_STATUSES,
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  })

  const sessionIdsToExpire = []
  for (const payment of active) {
    if (payment.stripeCheckoutSessionId) {
      sessionIdsToExpire.push(payment.stripeCheckoutSessionId)
    }
    await payment.update(
      {
        status: PAYMENT_STATUS.EXPIRED,
        activeAppointmentId: null,
      },
      { transaction }
    )
  }

  return sessionIdsToExpire
}

const expireCheckoutSessions = async (sessionIds, { appointmentId } = {}) => {
  if (!sessionIds?.length) return
  const stripe = getStripe()
  for (const sessionId of sessionIds) {
    try {
      await stripe.checkout.sessions.expire(sessionId)
    } catch (error) {
      logCancellation('warn', 'Failed to expire Stripe checkout session', {
        appointmentId,
        sessionId,
        error: error.message,
      })
    }
  }
}

/**
 * Validate whether an actor may cancel this appointment.
 */
export const validateCancellation = (appointment, {
  actorType,
  actorId = null,
  reason = null,
} = {}) => {
  if (!appointment) {
    throw new CancellationError('Appointment not found', { statusCode: 404, code: 'not_found' })
  }

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new CancellationError('Appointment already cancelled', {
      statusCode: 400,
      code: 'already_cancelled',
    })
  }

  if (isTerminalStatus(appointment.status)) {
    throw new CancellationError(
      appointment.status === APPOINTMENT_STATUS.COMPLETED
        ? 'Completed appointments cannot be cancelled'
        : `Cannot cancel appointment in status ${appointment.status}`,
      {
        statusCode: 400,
        code:
          appointment.status === APPOINTMENT_STATUS.COMPLETED
            ? 'cannot_cancel_completed'
            : 'invalid_status',
      }
    )
  }

  if (actorType === ACTOR_TYPE.USER && actorId && appointment.userId !== actorId) {
    throw new CancellationError('Unauthorized action', { statusCode: 403, code: 'unauthorized' })
  }

  if (actorType === ACTOR_TYPE.DOCTOR && actorId && appointment.docId !== actorId) {
    throw new CancellationError('Invalid doctor or appointment', {
      statusCode: 403,
      code: 'unauthorized',
    })
  }

  const paymentStatus = normalizePaymentStatus(appointment)
  const isPaid =
    paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAID ||
    paymentStatus === APPOINTMENT_PAYMENT_STATUS.REFUND_FAILED

  if (actorType === ACTOR_TYPE.ADMIN && isPaid && !String(reason || '').trim()) {
    throw new CancellationError('Refund reason is required when cancelling a paid appointment', {
      statusCode: 400,
      code: 'refund_reason_required',
    })
  }

  return { paymentStatus, isPaid }
}

const cancelWithPaymentMirror = async (
  appointmentId,
  {
    actorType,
    actorId,
    reason,
    paymentStatus,
    payment,
    metadata = null,
    transaction,
  }
) => {
  return cancelAppointmentLifecycle(appointmentId, {
    actorType,
    actorId,
    reason,
    extraFields: { paymentStatus, payment },
    metadata,
    transaction,
  })
}

/**
 * Unified cancellation entry point for user, doctor, admin, and system actors.
 *
 * Paid appointments always go through refund reconciliation — never cancel with
 * payment left as PAID.
 */
export const requestCancellation = async ({
  appointmentId,
  actorType = ACTOR_TYPE.USER,
  actorId = null,
  reason = null,
  createRefundFn = null,
  expireCheckout = true,
  now = new Date(),
} = {}) => {
  const cancelReason = String(reason || '').trim() || defaultReason(actorType)

  // Preview terminal states outside our transaction so lifecycle can commit
  // REJECTED history (it owns its own transaction for that path).
  const preview = await Appointment.findByPk(appointmentId)
  if (preview) {
    if (actorType === ACTOR_TYPE.USER && actorId && preview.userId !== actorId) {
      throw new CancellationError('Unauthorized action', { statusCode: 403, code: 'unauthorized' })
    }
    if (actorType === ACTOR_TYPE.DOCTOR && actorId && preview.docId !== actorId) {
      throw new CancellationError('Invalid doctor or appointment', {
        statusCode: 403,
        code: 'unauthorized',
      })
    }
    if (
      isTerminalStatus(preview.status) &&
      preview.status !== APPOINTMENT_STATUS.CANCELLED
    ) {
      await cancelAppointmentLifecycle(preview.id, {
        actorType,
        actorId,
        reason: cancelReason,
      })
    }
  }

  // ── Phase 1: validate + unpaid cancel OR initiate refund ─────────────────
  // Managed transaction: commits on resolve (including intentional REFUND_FAILED),
  // rolls back only if the callback throws.
  const phase1 = await withTransaction(async (transaction) => {
    const appointment = await Appointment.findByPk(appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })

    const { paymentStatus, isPaid } = validateCancellation(appointment, {
      actorType,
      actorId,
      reason,
    })

    logCancellation('info', 'Cancellation requested', {
      appointmentId,
      actorType,
      actorId,
      paymentStatus,
      appointmentStatus: appointment.status,
    })

    // Unpaid / pending / already-refunded → cancel immediately, no Stripe refund.
    if (
      paymentStatus === APPOINTMENT_PAYMENT_STATUS.UNPAID ||
      paymentStatus === APPOINTMENT_PAYMENT_STATUS.PENDING ||
      paymentStatus === APPOINTMENT_PAYMENT_STATUS.PENDING_RETRY ||
      paymentStatus === APPOINTMENT_PAYMENT_STATUS.PAYMENT_FAILED ||
      paymentStatus === APPOINTMENT_PAYMENT_STATUS.REFUNDED
    ) {
      const sessionIdsToExpire = await retireActivePayments(appointment, { transaction })

      const cancelled = await cancelWithPaymentMirror(appointment.id, {
        actorType,
        actorId,
        reason: cancelReason,
        paymentStatus:
          paymentStatus === APPOINTMENT_PAYMENT_STATUS.REFUNDED
            ? APPOINTMENT_PAYMENT_STATUS.REFUNDED
            : APPOINTMENT_PAYMENT_STATUS.UNPAID,
        payment: false,
        metadata: { refundRequired: false, paymentStatus },
        transaction,
      })

      await writeRefundAudit({
        appointmentId: cancelled.id,
        action: actorAuditAction(actorType),
        reason: cancelReason,
        performedBy: actorType,
        performedById: actorId,
        metadata: { refundRequired: false, paymentStatus },
        transaction,
      })

      return {
        done: true,
        appointment: cancelled,
        refundRequired: false,
        refund: null,
        message: 'Appointment Cancelled',
        sessionIdsToExpire: expireCheckout ? sessionIdsToExpire : [],
      }
    }

    // Refund already pending → cancel appointment if needed; do not create another refund.
    if (paymentStatus === APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING) {
      const payment = await findPaidPayment(appointment.id, { transaction, lock: true })
      let cancelled = appointment
      if (appointment.status !== APPOINTMENT_STATUS.CANCELLED) {
        cancelled = await cancelWithPaymentMirror(appointment.id, {
          actorType,
          actorId,
          reason: cancelReason,
          paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
          payment: true,
          transaction,
        })
      }
      await writeRefundAudit({
        appointmentId: cancelled.id,
        paymentTransactionId: payment?.id || null,
        action: REFUND_AUDIT_ACTION.REFUND_DUPLICATE_BLOCKED,
        reason: 'Cancellation while refund already pending',
        performedBy: actorType,
        performedById: actorId,
        stripeRefundId: payment?.stripeRefundId || null,
        metadata: { paymentStatus },
        transaction,
      })
      return {
        done: true,
        appointment: cancelled,
        refundRequired: true,
        refund: null,
        message: 'Cancellation recorded; refund already processing',
        refundPending: true,
      }
    }

    if (!isPaid) {
      throw new CancellationError(`Cannot cancel with payment status ${paymentStatus}`, {
        statusCode: 400,
        code: 'invalid_payment_status',
      })
    }

    const eligibility = calculateRefundEligibility(appointment, { actorType, now })
    if (!eligibility.eligible) {
      await writeRefundAudit({
        appointmentId: appointment.id,
        action: actorAuditAction(actorType),
        reason: eligibility.message,
        performedBy: actorType,
        performedById: actorId,
        metadata: {
          refundRequired: true,
          eligible: false,
          reasonCode: eligibility.reasonCode,
          hoursUntilAppointment: eligibility.hoursUntilAppointment,
        },
        transaction,
      })

      logCancellation('info', 'Cancellation rejected by refund policy', {
        appointmentId: appointment.id,
        paymentStatus,
        refundRequired: true,
        reasonCode: eligibility.reasonCode,
      })

      throw new CancellationError(eligibility.message, {
        statusCode: 400,
        code: eligibility.reasonCode === 'NO_REFUND_WINDOW' ? 'no_refund_window' : 'refund_not_eligible',
      })
    }

    const payment = await findPaidPayment(appointment.id, { transaction, lock: true })
    if (!payment) {
      throw new CancellationError('Paid appointment has no payment transaction record', {
        statusCode: 400,
        code: 'payment_not_found',
      })
    }

    if (payment.status === PAYMENT_STATUS.REFUND_PENDING || payment.status === PAYMENT_STATUS.REFUNDED) {
      await writeRefundAudit({
        appointmentId: appointment.id,
        paymentTransactionId: payment.id,
        action: REFUND_AUDIT_ACTION.REFUND_DUPLICATE_BLOCKED,
        amount: payment.refundAmount,
        reason: 'Duplicate refund request blocked',
        performedBy: actorType,
        performedById: actorId,
        stripeRefundId: payment.stripeRefundId,
        transaction,
      })

      let cancelled = appointment
      if (
        payment.status === PAYMENT_STATUS.REFUND_PENDING &&
        appointment.status !== APPOINTMENT_STATUS.CANCELLED
      ) {
        cancelled = await cancelWithPaymentMirror(appointment.id, {
          actorType,
          actorId,
          reason: cancelReason,
          paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
          payment: true,
          transaction,
        })
        return {
          done: true,
          appointment: cancelled,
          refundRequired: true,
          refund: null,
          message: 'Cancellation recorded; refund already processing',
          refundPending: true,
        }
      }

      throw new CancellationError('Refund already in progress or completed', {
        statusCode: 409,
        code: 'refund_duplicate',
      })
    }

    // Create Stripe refund inside this transaction. On Stripe failure, payment
    // becomes REFUND_FAILED and we return (commit) without cancelling.
    let refundResult
    try {
      refundResult = await processStripeRefund({
        payment,
        appointment,
        amountCents: eligibility.refundAmountCents,
        reason: cancelReason,
        actorType,
        actorId,
        auditAction: actorAuditAction(actorType),
        createRefundFn,
        transaction,
      })
    } catch (error) {
      // Catch so Sequelize commits REFUND_FAILED instead of rolling it back.
      if (error instanceof RefundError && error.code === 'stripe_refund_failed') {
        logCancellation('error', 'Refund failed — appointment not cancelled', {
          appointmentId: appointment.id,
          paymentStatus: APPOINTMENT_PAYMENT_STATUS.REFUND_FAILED,
          refundRequired: true,
          refundResult: 'failed',
          error: error.message,
        })
        return { done: true, failed: true, error }
      }
      throw error
    }

    if (refundResult.payment.status === PAYMENT_STATUS.REFUND_FAILED) {
      return {
        done: true,
        failed: true,
        error: new CancellationError('Refund failed; appointment was not cancelled', {
          statusCode: 502,
          code: 'stripe_refund_failed',
        }),
      }
    }

    return {
      done: false,
      appointmentId: appointment.id,
      eligibility,
      refund: refundResult.refund,
      payment: refundResult.payment,
      paymentMirrorStatus:
        refundResult.payment.status === PAYMENT_STATUS.REFUNDED
          ? APPOINTMENT_PAYMENT_STATUS.REFUNDED
          : APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
    }
  }, { operation: 'cancellation_phase1' })

  if (phase1.failed) {
    throw phase1.error
  }

  if (phase1.done) {
    if (!phase1.refundRequired) {
      logCancellation('info', 'Unpaid appointment cancelled', {
        appointmentId: phase1.appointment.id,
        paymentStatus: phase1.appointment.paymentStatus,
        refundRequired: false,
      })
    }
    // AFTER COMMIT: expire Stripe checkout sessions (external — not part of DB tx).
    if (phase1.sessionIdsToExpire?.length) {
      await expireCheckoutSessions(phase1.sessionIdsToExpire, {
        appointmentId: phase1.appointment.id,
      })
    }
    return phase1
  }

  // ── Phase 2: cancel appointment after refund is safely committed ─────────
  // Separated so a lifecycle failure cannot roll back a successful Stripe refund.
  // Transaction boundary: phase 1 (refund) already committed; this only cancels.
  try {
    const cancelled = await withTransaction(async (transaction) => {
      return cancelWithPaymentMirror(phase1.appointmentId, {
        actorType,
        actorId,
        reason: cancelReason,
        paymentStatus: phase1.paymentMirrorStatus,
        payment: phase1.paymentMirrorStatus !== APPOINTMENT_PAYMENT_STATUS.REFUNDED,
        metadata: {
          refundRequired: true,
          refundPercent: phase1.eligibility.refundPercent,
          refundAmountCents: phase1.eligibility.refundAmountCents,
          stripeRefundId: phase1.refund?.id || null,
          reasonCode: phase1.eligibility.reasonCode,
        },
        transaction,
      })
    }, { operation: 'cancellation_phase2' })

    logCancellation('info', 'Paid appointment cancelled with refund', {
      appointmentId: cancelled.id,
      paymentStatus: cancelled.paymentStatus,
      refundRequired: true,
      refundAmount: phase1.eligibility.refundAmountCents,
      stripeRefundId: phase1.refund?.id || null,
      refundResult: phase1.refund?.status || null,
    })

    const message =
      phase1.paymentMirrorStatus === APPOINTMENT_PAYMENT_STATUS.REFUNDED
        ? 'Appointment cancelled and payment refunded'
        : 'Appointment cancelled; refund processing'

    return {
      appointment: cancelled,
      refundRequired: true,
      refund: phase1.refund,
      payment: phase1.payment,
      eligibility: phase1.eligibility,
      message,
      refundPending: phase1.paymentMirrorStatus === APPOINTMENT_PAYMENT_STATUS.REFUND_PENDING,
    }
  } catch (error) {
    // Post-commit catch: phase 1 refund is already durable; do not attempt rollback.
    logCancellation('error', 'Refund created but appointment cancel failed', {
      appointmentId: phase1.appointmentId,
      paymentStatus: phase1.paymentMirrorStatus,
      refundRequired: true,
      stripeRefundId: phase1.refund?.id || null,
      error: error.message,
    })
    throw error
  }
}

export { LifecycleError, RefundError, ACTOR_TYPE, APPOINTMENT_STATUS }
