import { Op, UniqueConstraintError } from 'sequelize'
import Appointment from '../models/appointmentModel.js'
import Doctor from '../models/doctorModel.js'
import User from '../models/userModel.js'
import { lockDoctorForUpdate } from '../utils/lockDoctor.js'
import { toSafeDoctorSnapshot } from '../utils/appointmentSlots.js'
import { withTransaction } from '../utils/databaseTransaction.js'
import {
  isFutureSlot,
  isWithinWorkingHours,
  normalizeStartTime,
  parseLegacySlot,
  parseStartTimeInput,
  toLegacySlotFields,
} from '../utils/slotTime.js'
import {
  APPOINTMENT_STATUS,
  SLOT_HOLDING_STATUSES,
  ACTOR_TYPE,
  recordInitialStatus,
  isReschedulableStatus,
} from './appointmentStateService.js'
import { calculateAppointmentAmount, PricingError } from './pricingService.js'

export { APPOINTMENT_STATUS, SLOT_HOLDING_STATUSES }

export class SchedulingError extends Error {
  constructor(message, { statusCode = 400, code = 'scheduling_error' } = {}) {
    super(message)
    this.name = 'SchedulingError'
    this.statusCode = statusCode
    this.code = code
  }
}

const logScheduling = (level, message, meta = {}) => {
  const entry = {
    scope: 'scheduling',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

/**
 * In-process per-doctor queue. Serializes booking/reschedule for the same doctor
 * within a single Node process (needed for SQLite; reduces contention on MySQL).
 * Multi-instance safety still relies on DB unique(docId, heldStartTime) + row locks.
 */
const doctorQueues = new Map()

const withDoctorQueue = async (doctorId, fn) => {
  const previous = doctorQueues.get(doctorId) || Promise.resolve()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const chained = previous.then(() => gate)
  doctorQueues.set(doctorId, chained)

  await previous
  try {
    return await fn()
  } finally {
    release()
    if (doctorQueues.get(doctorId) === chained) {
      doctorQueues.delete(doctorId)
    }
  }
}

const isUniqueViolation = (error) =>
  error instanceof UniqueConstraintError ||
  error?.name === 'SequelizeUniqueConstraintError' ||
  /unique constraint|UNIQUE constraint failed|Duplicate entry/i.test(error?.message || '') ||
  /unique constraint|UNIQUE constraint failed|Duplicate entry/i.test(error?.parent?.message || '')

const lockAppointmentRow = async (appointmentId, transaction) => {
  const dialect = Appointment.sequelize.getDialect()
  if (dialect === 'mysql') {
    return Appointment.findByPk(appointmentId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    })
  }
  return Appointment.findByPk(appointmentId, { transaction })
}

/**
 * Resolve request body into a canonical startTime Date.
 * Prefers startTime ISO; falls back to legacy slotDate + slotTime.
 */
export const resolveRequestedStartTime = ({ startTime, slotDate, slotTime, newStartTime, newSlotDate, newSlotTime }) => {
  const isoCandidate = startTime || newStartTime
  if (isoCandidate) {
    const parsed = parseStartTimeInput(isoCandidate)
    if (!parsed) {
      throw new SchedulingError('Invalid startTime. Use ISO-8601 with timezone offset, e.g. 2026-07-20T10:00:00+05:00', {
        statusCode: 400,
        code: 'invalid_start_time',
      })
    }
    return normalizeStartTime(parsed)
  }

  const legacyDate = slotDate || newSlotDate
  const legacyTime = slotTime || newSlotTime
  if (legacyDate && legacyTime) {
    const parsed = parseLegacySlot(legacyDate, legacyTime)
    if (!parsed) {
      throw new SchedulingError('Invalid slotDate/slotTime', {
        statusCode: 400,
        code: 'invalid_legacy_slot',
      })
    }
    return normalizeStartTime(parsed)
  }

  throw new SchedulingError('Missing startTime', {
    statusCode: 400,
    code: 'missing_start_time',
  })
}

export const validateSlot = async ({
  doctorId,
  startTime,
  excludeAppointmentId = null,
  doctor = null,
  transaction = null,
}) => {
  if (!doctorId) {
    throw new SchedulingError('Missing doctorId', { statusCode: 400, code: 'missing_doctor' })
  }
  if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime())) {
    throw new SchedulingError('Invalid startTime', { statusCode: 400, code: 'invalid_start_time' })
  }

  const doc =
    doctor ||
    (await Doctor.findByPk(doctorId, { transaction }))

  if (!doc) {
    throw new SchedulingError('Doctor not found', { statusCode: 404, code: 'doctor_not_found' })
  }
  if (!doc.available) {
    throw new SchedulingError('Doctor Not Available', { statusCode: 400, code: 'doctor_unavailable' })
  }

  if (!isFutureSlot(startTime)) {
    throw new SchedulingError('Cannot book a past appointment slot', {
      statusCode: 400,
      code: 'past_slot',
    })
  }

  if (!isWithinWorkingHours(startTime)) {
    throw new SchedulingError('Requested time is outside doctor working hours or not on a valid interval', {
      statusCode: 400,
      code: 'outside_working_hours',
    })
  }

  const where = {
    docId: doctorId,
    heldStartTime: startTime,
    status: { [Op.in]: SLOT_HOLDING_STATUSES },
  }
  if (excludeAppointmentId) {
    where.id = { [Op.ne]: excludeAppointmentId }
  }

  const conflict = await Appointment.findOne({
    where,
    transaction,
    attributes: ['id'],
  })

  if (conflict) {
    throw new SchedulingError('This appointment slot is no longer available', {
      statusCode: 409,
      code: 'slot_unavailable',
    })
  }

  return { doctor: doc, startTime }
}

const syncSlotsBookedCache = (slotsBooked, { add, remove } = {}) => {
  const next = { ...(slotsBooked || {}) }
  if (remove?.slotDate && remove?.slotTime) {
    if (next[remove.slotDate]) {
      next[remove.slotDate] = next[remove.slotDate].filter((t) => t !== remove.slotTime)
      if (next[remove.slotDate].length === 0) delete next[remove.slotDate]
    }
  }
  if (add?.slotDate && add?.slotTime) {
    if (!next[add.slotDate]) next[add.slotDate] = []
    if (!next[add.slotDate].includes(add.slotTime)) {
      next[add.slotDate].push(add.slotTime)
    }
  }
  return next
}

/**
 * Atomically create an appointment with row lock + unique constraint protection.
 */
export const createAppointment = async ({
  doctorId,
  userId,
  startTime: startTimeInput,
  slotDate,
  slotTime,
  payMode = 'later',
}) => {
  if (!['now', 'later'].includes(payMode)) {
    throw new SchedulingError('Invalid payMode. Use "now" or "later".', {
      statusCode: 400,
      code: 'invalid_pay_mode',
    })
  }

  const startTime = resolveRequestedStartTime({ startTime: startTimeInput, slotDate, slotTime })

  logScheduling('info', 'booking_attempt', {
    doctorId,
    startTime: startTime.toISOString(),
    payMode,
  })

  return withDoctorQueue(doctorId, async () => {
    try {
      // DB-only transaction: validate + create. External side effects (Stripe, email)
      // must run after this managed transaction commits.
      const appointment = await withTransaction(async (transaction) => {
        const doctor = await lockDoctorForUpdate(doctorId, transaction)
        await validateSlot({ doctorId, startTime, doctor, transaction })

        const userData = await User.findByPk(userId, {
          attributes: { exclude: ['password', 'resetToken', 'resetTokenExpiry'] },
          transaction,
        })
        if (!userData) {
          throw new SchedulingError('User not found', { statusCode: 404, code: 'user_not_found' })
        }

        const legacy = toLegacySlotFields(startTime)
        const paymentStatus = payMode === 'now' ? 'pending' : 'unpaid'
        const status =
          payMode === 'now' ? APPOINTMENT_STATUS.PENDING_PAYMENT : APPOINTMENT_STATUS.CONFIRMED
        const now = new Date()

        // Snapshot fee at booking time — never trust client amount / never re-read later.
        const { amount: appointmentAmount, currency } = calculateAppointmentAmount(doctor)

        const created = await Appointment.create(
          {
            userId,
            docId: doctorId,
            userData: userData.toJSON(),
            docData: toSafeDoctorSnapshot(doctor),
            amount: appointmentAmount,
            currency,
            startTime,
            heldStartTime: startTime,
            slotDate: legacy.slotDate,
            slotTime: legacy.slotTime,
            date: Date.now(),
            payment: false,
            paymentStatus,
            status,
            statusChangedAt: now,
            cancelled: false,
            isCompleted: false,
          },
          { transaction }
        )

        await recordInitialStatus(created, {
          actorType: ACTOR_TYPE.USER,
          actorId: userId,
          reason: payMode === 'now' ? 'Booked with pay-now hold' : 'Booked with pay-later confirmation',
          metadata: { payMode },
          transaction,
        })

        // Denormalized cache for legacy UI only — appointments remain source of truth.
        const slots_booked = syncSlotsBookedCache(doctor.slots_booked, { add: legacy })
        await Doctor.update({ slots_booked }, { where: { id: doctorId }, transaction })

        return created
      }, { operation: 'create_appointment' })

      logScheduling('info', 'booking_created', {
        doctorId,
        appointmentId: appointment.id,
        startTime: startTime.toISOString(),
        status: appointment.status,
      })

      return appointment
    } catch (error) {
      if (isUniqueViolation(error)) {
        logScheduling('warn', 'unique_constraint_failure', {
          doctorId,
          startTime: startTime.toISOString(),
        })
        throw new SchedulingError('This appointment slot is no longer available', {
          statusCode: 409,
          code: 'slot_unavailable',
        })
      }

      if (error instanceof SchedulingError || error instanceof PricingError) {
        logScheduling('info', 'validation_rejected', {
          doctorId,
          startTime: startTime.toISOString(),
          code: error.code,
        })
        throw error
      }

      logScheduling('error', 'booking_failed', {
        doctorId,
        startTime: startTime.toISOString(),
        error: error.message,
      })
      throw error
    }
  })
}

/**
 * Reschedule with the same transactional + unique-constraint guarantees as booking.
 * Only CONFIRMED appointments may be rescheduled.
 */
export const rescheduleAppointment = async ({
  appointmentId,
  userId,
  newStartTime,
  newSlotDate,
  newSlotTime,
}) => {
  const startTime = resolveRequestedStartTime({
    startTime: newStartTime,
    slotDate: newSlotDate,
    slotTime: newSlotTime,
  })

  logScheduling('info', 'reschedule_attempt', {
    appointmentId,
    startTime: startTime.toISOString(),
  })

  const existing = await Appointment.findByPk(appointmentId)
  if (!existing) {
    throw new SchedulingError('Appointment not found', { statusCode: 404, code: 'not_found' })
  }
  if (existing.userId !== userId) {
    throw new SchedulingError('Unauthorized action', { statusCode: 403, code: 'unauthorized' })
  }

  return withDoctorQueue(existing.docId, async () => {
    try {
      // DB-only transaction: lock + validate + update. Notifications / external APIs
      // must run after this managed transaction commits — never roll back on their failure.
      const appointment = await withTransaction(async (transaction) => {
        const locked = await lockAppointmentRow(appointmentId, transaction)
        if (!locked) {
          throw new SchedulingError('Appointment not found', { statusCode: 404, code: 'not_found' })
        }
        if (locked.userId !== userId) {
          throw new SchedulingError('Unauthorized action', { statusCode: 403, code: 'unauthorized' })
        }
        if (!isReschedulableStatus(locked.status)) {
          throw new SchedulingError('Cannot reschedule this appointment', {
            statusCode: 400,
            code: 'not_reschedulable',
          })
        }

        const doctor = await lockDoctorForUpdate(locked.docId, transaction)
        await validateSlot({
          doctorId: locked.docId,
          startTime,
          excludeAppointmentId: locked.id,
          doctor,
          transaction,
        })

        const oldLegacy =
          locked.startTime
            ? toLegacySlotFields(new Date(locked.startTime))
            : { slotDate: locked.slotDate, slotTime: locked.slotTime }
        const newLegacy = toLegacySlotFields(startTime)

        await locked.update(
          {
            startTime,
            heldStartTime: startTime,
            slotDate: newLegacy.slotDate,
            slotTime: newLegacy.slotTime,
          },
          { transaction }
        )

        let slots_booked = syncSlotsBookedCache(doctor.slots_booked, { remove: oldLegacy })
        slots_booked = syncSlotsBookedCache(slots_booked, { add: newLegacy })
        await Doctor.update({ slots_booked }, { where: { id: locked.docId }, transaction })

        return locked
      }, { operation: 'reschedule_appointment' })

      logScheduling('info', 'reschedule_completed', {
        appointmentId,
        doctorId: appointment.docId,
        startTime: startTime.toISOString(),
      })

      return appointment
    } catch (error) {
      // Managed transaction already committed or rolled back — never call rollback here.
      if (isUniqueViolation(error)) {
        logScheduling('warn', 'unique_constraint_failure', {
          appointmentId,
          startTime: startTime.toISOString(),
        })
        throw new SchedulingError('This appointment slot is no longer available', {
          statusCode: 409,
          code: 'slot_unavailable',
        })
      }

      if (error instanceof SchedulingError) {
        logScheduling('info', 'reschedule_rejected', {
          appointmentId,
          startTime: startTime.toISOString(),
          code: error.code,
        })
        throw error
      }

      throw error
    }
  })
}
