/**
 * Configurable refund eligibility based on time-to-appointment and actor.
 *
 * Env:
 *   FULL_REFUND_HOURS=24      → 100% refund when start is farther than this
 *   PARTIAL_REFUND_HOURS=2    → 0% when closer than this; partial between partial and full
 *   PARTIAL_REFUND_PERCENT=50 → percent refunded in the partial window
 */

const parsePositiveNumber = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export const getRefundPolicyConfig = () => ({
  fullRefundHours: parsePositiveNumber(process.env.FULL_REFUND_HOURS, 24),
  partialRefundHours: parsePositiveNumber(process.env.PARTIAL_REFUND_HOURS, 2),
  partialRefundPercent: parsePositiveNumber(process.env.PARTIAL_REFUND_PERCENT, 50),
})

export const CANCELLATION_ACTOR = {
  USER: 'USER',
  PATIENT: 'PATIENT',
  DOCTOR: 'DOCTOR',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
}

/**
 * @param {object} appointment
 * @param {object} options
 * @param {string} options.actorType USER|PATIENT|DOCTOR|ADMIN|SYSTEM
 * @param {Date} [options.now]
 * @returns {{
 *   eligible: boolean,
 *   refundPercent: number,
 *   refundAmountCents: number,
 *   reasonCode: string,
 *   message: string,
 *   hoursUntilAppointment: number|null,
 * }}
 */
export const calculateRefundEligibility = (appointment, { actorType, now = new Date() } = {}) => {
  const config = getRefundPolicyConfig()
  const amountCents = Math.round(Number(appointment.amount || 0) * 100)
  const normalizedActor = String(actorType || '').toUpperCase()
  const isPatient = normalizedActor === CANCELLATION_ACTOR.USER || normalizedActor === CANCELLATION_ACTOR.PATIENT

  // Clinic-initiated cancellations always receive a full refund.
  if (
    normalizedActor === CANCELLATION_ACTOR.DOCTOR ||
    normalizedActor === CANCELLATION_ACTOR.ADMIN ||
    normalizedActor === CANCELLATION_ACTOR.SYSTEM
  ) {
    return {
      eligible: true,
      refundPercent: 100,
      refundAmountCents: amountCents,
      reasonCode:
        normalizedActor === CANCELLATION_ACTOR.DOCTOR
          ? 'DOCTOR_UNAVAILABLE'
          : normalizedActor === CANCELLATION_ACTOR.ADMIN
            ? 'ADMIN_CANCELLED'
            : 'AUTO_CANCELLED',
      message: 'Full refund for clinic-initiated cancellation',
      hoursUntilAppointment: hoursUntil(appointment.startTime, now),
      policy: config,
    }
  }

  if (!isPatient) {
    return {
      eligible: false,
      refundPercent: 0,
      refundAmountCents: 0,
      reasonCode: 'UNKNOWN_ACTOR',
      message: 'Unknown cancellation actor',
      hoursUntilAppointment: hoursUntil(appointment.startTime, now),
      policy: config,
    }
  }

  const hours = hoursUntil(appointment.startTime, now)
  if (hours === null) {
    return {
      eligible: false,
      refundPercent: 0,
      refundAmountCents: 0,
      reasonCode: 'MISSING_START_TIME',
      message: 'Appointment start time is required to evaluate refund policy',
      hoursUntilAppointment: null,
      policy: config,
    }
  }

  if (hours >= config.fullRefundHours) {
    return {
      eligible: true,
      refundPercent: 100,
      refundAmountCents: amountCents,
      reasonCode: 'FULL_REFUND_WINDOW',
      message: `Full refund (${config.fullRefundHours}+ hours before appointment)`,
      hoursUntilAppointment: hours,
      policy: config,
    }
  }

  if (hours >= config.partialRefundHours) {
    const refundAmountCents = Math.round((amountCents * config.partialRefundPercent) / 100)
    return {
      eligible: refundAmountCents > 0,
      refundPercent: config.partialRefundPercent,
      refundAmountCents,
      reasonCode: 'PARTIAL_REFUND_WINDOW',
      message: `${config.partialRefundPercent}% refund (${config.partialRefundHours}–${config.fullRefundHours} hours before appointment)`,
      hoursUntilAppointment: hours,
      policy: config,
    }
  }

  return {
    eligible: false,
    refundPercent: 0,
    refundAmountCents: 0,
    reasonCode: 'NO_REFUND_WINDOW',
    message: `No refund within ${config.partialRefundHours} hours of appointment`,
    hoursUntilAppointment: hours,
    policy: config,
  }
}

const hoursUntil = (startTime, now) => {
  if (!startTime) return null
  const start = new Date(startTime)
  if (Number.isNaN(start.getTime())) return null
  return (start.getTime() - now.getTime()) / (1000 * 60 * 60)
}
