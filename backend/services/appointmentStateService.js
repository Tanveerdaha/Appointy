import sequelize from '../config/mysql.js'
import Appointment, {
  APPOINTMENT_STATUS,
  SLOT_HOLDING_STATUSES,
  APPOINTMENT_STATUS_VALUES,
} from '../models/appointmentModel.js'
import AppointmentHistory, {
  ACTOR_TYPE,
  HISTORY_OUTCOME,
} from '../models/appointmentHistoryModel.js'
import { lockDoctorForUpdate } from '../utils/lockDoctor.js'
import { toLegacySlotFields } from '../utils/slotTime.js'

export { APPOINTMENT_STATUS, SLOT_HOLDING_STATUSES, APPOINTMENT_STATUS_VALUES }
export { ACTOR_TYPE, HISTORY_OUTCOME }

/** Legal appointment lifecycle transitions. Refunds are payment-only. */
export const TRANSITIONS = {
  [APPOINTMENT_STATUS.PENDING_PAYMENT]: [
    APPOINTMENT_STATUS.CONFIRMED,
    APPOINTMENT_STATUS.CANCELLED,
  ],
  [APPOINTMENT_STATUS.CONFIRMED]: [
    APPOINTMENT_STATUS.COMPLETED,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.NO_SHOW,
  ],
  [APPOINTMENT_STATUS.COMPLETED]: [],
  [APPOINTMENT_STATUS.CANCELLED]: [],
  [APPOINTMENT_STATUS.NO_SHOW]: [],
}

export class LifecycleError extends Error {
  constructor(message, { statusCode = 400, code = 'invalid_transition' } = {}) {
    super(message)
    this.name = 'LifecycleError'
    this.statusCode = statusCode
    this.code = code
  }
}

export const canTransition = (currentStatus, newStatus) => {
  if (!currentStatus || !newStatus) return false
  if (currentStatus === newStatus) return false
  const allowed = TRANSITIONS[currentStatus]
  return Array.isArray(allowed) && allowed.includes(newStatus)
}

const transitionMessage = (currentStatus, newStatus) => {
  if (currentStatus === APPOINTMENT_STATUS.COMPLETED && newStatus === APPOINTMENT_STATUS.CANCELLED) {
    return 'Completed appointments cannot be cancelled'
  }
  if (currentStatus === APPOINTMENT_STATUS.CANCELLED && newStatus === APPOINTMENT_STATUS.COMPLETED) {
    return 'Cancelled appointments cannot be completed'
  }
  if (currentStatus === APPOINTMENT_STATUS.COMPLETED && newStatus === APPOINTMENT_STATUS.COMPLETED) {
    return 'Appointment already completed'
  }
  if (currentStatus === APPOINTMENT_STATUS.CANCELLED && newStatus === APPOINTMENT_STATUS.CANCELLED) {
    return 'Appointment already cancelled'
  }
  return `Invalid transition ${currentStatus} -> ${newStatus}`
}

const logLifecycle = (level, message, meta = {}) => {
  const entry = {
    scope: 'appointment_lifecycle',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

const holdsSlot = (status) => SLOT_HOLDING_STATUSES.includes(status)

/** Sync deprecated booleans + timestamps + heldStartTime from canonical status. */
export const compatibilityFieldsForStatus = (status, appointment, { now = new Date() } = {}) => {
  const fields = {
    status,
    statusChangedAt: now,
    cancelled: status === APPOINTMENT_STATUS.CANCELLED || status === APPOINTMENT_STATUS.NO_SHOW,
    isCompleted: status === APPOINTMENT_STATUS.COMPLETED,
  }

  if (status === APPOINTMENT_STATUS.COMPLETED) {
    fields.completedAt = appointment.completedAt || now
  }
  if (status === APPOINTMENT_STATUS.CANCELLED || status === APPOINTMENT_STATUS.NO_SHOW) {
    fields.cancelledAt = appointment.cancelledAt || now
    fields.heldStartTime = null
  } else if (holdsSlot(status)) {
    fields.heldStartTime = appointment.heldStartTime || appointment.startTime
  }

  return fields
}

const syncSlotsBookedCache = (slotsBooked, { remove } = {}) => {
  const next = { ...(slotsBooked || {}) }
  if (remove?.slotDate && remove?.slotTime) {
    if (next[remove.slotDate]) {
      next[remove.slotDate] = next[remove.slotDate].filter((t) => t !== remove.slotTime)
      if (next[remove.slotDate].length === 0) delete next[remove.slotDate]
    }
  }
  return next
}

const releaseDoctorSlotCache = async (appointment, transaction) => {
  const doctor = await lockDoctorForUpdate(appointment.docId, transaction)
  if (!doctor) return
  const legacy = appointment.startTime
    ? toLegacySlotFields(new Date(appointment.startTime))
    : { slotDate: appointment.slotDate, slotTime: appointment.slotTime }
  const slots_booked = syncSlotsBookedCache(doctor.slots_booked, { remove: legacy })
  await doctor.update({ slots_booked }, { transaction })
}

const lockAppointment = async (appointmentId, transaction) => {
  const dialect = Appointment.sequelize.getDialect()
  if (dialect === 'mysql') {
    return Appointment.findByPk(appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
  }
  return Appointment.findByPk(appointmentId, { transaction })
}

const writeHistory = async ({
  appointmentId,
  oldStatus,
  newStatus,
  outcome,
  actorType,
  actorId = null,
  reason = null,
  errorCode = null,
  metadata = null,
  occurredAt = new Date(),
  transaction,
}) => {
  return AppointmentHistory.create(
    {
      appointmentId,
      oldStatus,
      newStatus,
      outcome,
      actorType,
      actorId,
      reason,
      errorCode,
      metadata,
      occurredAt,
    },
    { transaction }
  )
}

/**
 * Record the initial status when an appointment is created (inside the booking transaction).
 */
export const recordInitialStatus = async (
  appointment,
  {
    actorType = ACTOR_TYPE.USER,
    actorId = null,
    reason = 'Appointment created',
    metadata = null,
    transaction,
  } = {}
) => {
  const now = new Date()
  if (!appointment.statusChangedAt) {
    await appointment.update({ statusChangedAt: now }, { transaction })
  }
  await writeHistory({
    appointmentId: appointment.id,
    oldStatus: null,
    newStatus: appointment.status,
    outcome: HISTORY_OUTCOME.SUCCEEDED,
    actorType,
    actorId,
    reason,
    metadata,
    occurredAt: now,
    transaction,
  })
}

/**
 * Atomically transition an appointment to a new lifecycle status.
 *
 * @param {string|object} appointmentOrId Appointment instance or id
 * @param {string} newStatus Target status
 * @param {object} options
 * @param {string} options.actorType
 * @param {string|null} options.actorId
 * @param {string|null} options.reason
 * @param {object|null} options.metadata Non-sensitive audit metadata
 * @param {object} [options.extraFields] Additional appointment column updates
 * @param {import('sequelize').Transaction} [options.transaction] Caller-owned transaction
 * @param {boolean} [options.skipSlotCache] Skip doctor slots_booked cache update
 * @param {boolean} [options.recordRejectedAttempt=true] Persist rejected attempts to history
 */
export const transitionAppointment = async (
  appointmentOrId,
  newStatus,
  {
    actorType = ACTOR_TYPE.SYSTEM,
    actorId = null,
    reason = null,
    metadata = null,
    extraFields = {},
    transaction: outerTx = null,
    skipSlotCache = false,
    recordRejectedAttempt = true,
  } = {}
) => {
  if (!APPOINTMENT_STATUS_VALUES.includes(newStatus)) {
    throw new LifecycleError(`Unknown appointment status: ${newStatus}`, {
      statusCode: 400,
      code: 'unknown_status',
    })
  }

  const run = async (transaction, ownsTransaction) => {
    const appointmentId =
      typeof appointmentOrId === 'string' ? appointmentOrId : appointmentOrId?.id
    if (!appointmentId) {
      throw new LifecycleError('Appointment not found', {
        statusCode: 404,
        code: 'not_found',
      })
    }

    const appointment = await lockAppointment(appointmentId, transaction)
    if (!appointment) {
      throw new LifecycleError('Appointment not found', {
        statusCode: 404,
        code: 'not_found',
      })
    }

    const currentStatus = appointment.status
    const now = new Date()

    logLifecycle('info', 'Appointment transition attempted', {
      appointmentId: appointment.id,
      oldStatus: currentStatus,
      newStatus,
      actor: actorType,
      actorId,
    })

    if (!canTransition(currentStatus, newStatus)) {
      const message = transitionMessage(currentStatus, newStatus)
      const code =
        currentStatus === APPOINTMENT_STATUS.COMPLETED &&
        newStatus === APPOINTMENT_STATUS.CANCELLED
          ? 'cannot_cancel_completed'
          : currentStatus === APPOINTMENT_STATUS.CANCELLED &&
              newStatus === APPOINTMENT_STATUS.COMPLETED
            ? 'cannot_complete_cancelled'
            : 'invalid_transition'

      if (recordRejectedAttempt) {
        // Persist the rejected attempt in its own committed unit when we own the tx,
        // or inside the caller tx when provided (caller decides commit/rollback).
        // For owned transactions we commit the rejection history then throw.
        await writeHistory({
          appointmentId: appointment.id,
          oldStatus: currentStatus,
          newStatus: currentStatus,
          outcome: HISTORY_OUTCOME.REJECTED,
          actorType,
          actorId,
          reason: reason || message,
          errorCode: code,
          metadata: {
            ...(metadata || {}),
            requestedStatus: newStatus,
          },
          occurredAt: now,
          transaction,
        })

        if (ownsTransaction) {
          await transaction.commit()
        }
      }

      logLifecycle('info', 'Appointment transition failed', {
        appointmentId: appointment.id,
        oldStatus: currentStatus,
        newStatus,
        actor: actorType,
        success: false,
        reason: message,
        code,
      })

      throw new LifecycleError(message, { statusCode: 400, code })
    }

    const wasHolding = holdsSlot(currentStatus)
    const willHold = holdsSlot(newStatus)
    const fields = {
      ...compatibilityFieldsForStatus(newStatus, appointment, { now }),
      ...extraFields,
    }

    await appointment.update(fields, { transaction })

    if (wasHolding && !willHold && !skipSlotCache) {
      await releaseDoctorSlotCache(appointment, transaction)
    }

    await writeHistory({
      appointmentId: appointment.id,
      oldStatus: currentStatus,
      newStatus,
      outcome: HISTORY_OUTCOME.SUCCEEDED,
      actorType,
      actorId,
      reason,
      metadata,
      occurredAt: now,
      transaction,
    })

    if (ownsTransaction) {
      await transaction.commit()
    }

    logLifecycle('info', 'Appointment transition succeeded', {
      appointmentId: appointment.id,
      oldStatus: currentStatus,
      newStatus,
      actor: actorType,
      success: true,
      reason,
    })

    await appointment.reload({ transaction: ownsTransaction ? undefined : transaction })
    return appointment
  }

  if (outerTx) {
    return run(outerTx, false)
  }

  const transaction = await sequelize.transaction()
  try {
    return await run(transaction, true)
  } catch (error) {
    if (!transaction.finished) {
      try {
        await transaction.rollback()
      } catch {
        // already finished (e.g. rejected attempt committed)
      }
    }
    throw error
  }
}

export const cancelAppointment = async (appointmentOrId, options = {}) =>
  transitionAppointment(appointmentOrId, APPOINTMENT_STATUS.CANCELLED, options)

export const completeAppointment = async (appointmentOrId, options = {}) =>
  transitionAppointment(appointmentOrId, APPOINTMENT_STATUS.COMPLETED, options)

export const confirmAfterPayment = async (appointmentOrId, options = {}) =>
  transitionAppointment(appointmentOrId, APPOINTMENT_STATUS.CONFIRMED, {
    actorType: ACTOR_TYPE.SYSTEM,
    reason: options.reason || 'Payment confirmed',
    ...options,
  })

export const isTerminalStatus = (status) =>
  status === APPOINTMENT_STATUS.COMPLETED ||
  status === APPOINTMENT_STATUS.CANCELLED ||
  status === APPOINTMENT_STATUS.NO_SHOW

export const isReschedulableStatus = (status) => status === APPOINTMENT_STATUS.CONFIRMED
