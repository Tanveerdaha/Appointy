/**
 * Server-owned PENDING_PAYMENT hold expiration.
 * Holds expire independently of Stripe so abandoned / failed checkout attempts
 * cannot block a doctor slot indefinitely.
 */
import { Op } from 'sequelize'
import Appointment, { APPOINTMENT_STATUS } from '../models/appointmentModel.js'
import {
  requestCancellation,
  CancellationError,
  ACTOR_TYPE,
} from './cancellationService.js'

const DEFAULT_HOLD_EXPIRY_MINUTES = 60
const DEFAULT_BATCH_SIZE = 10
const HOLD_EXPIRED_REASON = 'Payment hold expired'

const logHold = (level, message, meta = {}) => {
  const entry = {
    scope: 'payment_hold',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

export const getHoldExpiryMs = () => {
  const minutes = Number(process.env.APPOINTMENT_HOLD_EXPIRY_MINUTES || DEFAULT_HOLD_EXPIRY_MINUTES)
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_HOLD_EXPIRY_MINUTES
  return safeMinutes * 60 * 1000
}

export const computeHoldExpiresAt = (now = new Date()) =>
  new Date(now.getTime() + getHoldExpiryMs())

export const isPaymentHoldExpired = (appointment, now = new Date()) => {
  if (!appointment || appointment.status !== APPOINTMENT_STATUS.PENDING_PAYMENT) return false
  const expiresAt = appointment.holdExpiresAt
  if (!expiresAt) return false
  const expiresMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiresMs)) return false
  return expiresMs <= now.getTime()
}

export const findDuePaymentHolds = async ({
  limit = DEFAULT_BATCH_SIZE,
  now = new Date(),
} = {}) => {
  return Appointment.findAll({
    where: {
      status: APPOINTMENT_STATUS.PENDING_PAYMENT,
      holdExpiresAt: { [Op.lte]: now },
    },
    order: [['holdExpiresAt', 'ASC']],
    limit,
  })
}

/**
 * Cancel a single due PENDING_PAYMENT hold and release the slot.
 * Idempotent under races with Stripe webhooks / concurrent workers.
 */
export const releaseExpiredPaymentHold = async (
  appointmentId,
  { expireCheckout = true, now = new Date() } = {}
) => {
  const appointment = await Appointment.findByPk(appointmentId)
  if (!appointment) {
    return { ok: true, outcome: 'not_found' }
  }

  if (appointment.status !== APPOINTMENT_STATUS.PENDING_PAYMENT) {
    return { ok: true, outcome: 'not_pending_payment' }
  }

  if (appointment.paymentStatus === 'paid' || appointment.payment === true) {
    return { ok: true, outcome: 'already_paid' }
  }

  if (!isPaymentHoldExpired(appointment, now)) {
    return { ok: true, outcome: 'not_due' }
  }

  try {
    await requestCancellation({
      appointmentId,
      actorType: ACTOR_TYPE.SYSTEM,
      reason: HOLD_EXPIRED_REASON,
      expireCheckout,
      now,
    })
    logHold('info', 'Expired payment hold released', { appointmentId })
    return { ok: true, outcome: 'released' }
  } catch (error) {
    if (error instanceof CancellationError) {
      const benign = new Set([
        'already_cancelled',
        'not_found',
        'cannot_cancel_completed',
        'invalid_status',
      ])
      if (benign.has(error.code)) {
        return { ok: true, outcome: error.code }
      }
    }
    throw error
  }
}

export const releaseExpiredPaymentHolds = async ({
  limit = DEFAULT_BATCH_SIZE,
  now = new Date(),
  expireCheckout = true,
} = {}) => {
  const due = await findDuePaymentHolds({ limit, now })
  const results = []

  for (const appointment of due) {
    try {
      const result = await releaseExpiredPaymentHold(appointment.id, { expireCheckout, now })
      results.push({ appointmentId: appointment.id, ...result })
    } catch (error) {
      logHold('error', 'Failed to release expired payment hold', {
        appointmentId: appointment.id,
        error: error.message,
      })
      results.push({
        appointmentId: appointment.id,
        ok: false,
        outcome: 'error',
        error: error.message,
      })
    }
  }

  return results
}
