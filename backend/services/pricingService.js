import Doctor from '../models/doctorModel.js'
import DoctorPriceHistory from '../models/doctorPriceHistoryModel.js'
import {
  getConfiguredCurrency,
  normalizeCurrency,
  toStripeCurrency,
  currenciesMatch,
} from './currencyService.js'

export class PricingError extends Error {
  constructor(message, { statusCode = 400, code = 'invalid_fee' } = {}) {
    super(message)
    this.name = 'PricingError'
    this.statusCode = statusCode
    this.code = code
  }
}

const FEE_PRECISION = 2

export const getFeeLimits = () => {
  const min = Number(process.env.MIN_APPOINTMENT_FEE || 100)
  const max = Number(process.env.MAX_APPOINTMENT_FEE || 1000000)

  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
    throw new PricingError('Pricing limits are misconfigured', {
      statusCode: 500,
      code: 'pricing_config_invalid',
    })
  }

  return {
    min,
    max,
    precision: FEE_PRECISION,
    currency: getConfiguredCurrency(),
  }
}

const logPricing = (level, message, meta = {}) => {
  const entry = {
    scope: 'pricing',
    level,
    message,
    ...meta,
    at: new Date().toISOString(),
  }
  if (level === 'error') console.error(JSON.stringify(entry))
  else if (level === 'warn') console.warn(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}

/**
 * Coerce a fee-like value to a finite number, or return null if impossible.
 * Rejects objects, arrays, empty strings, and numeric strings with junk.
 */
const coerceNumericFee = (fee) => {
  if (fee == null) return null
  if (typeof fee === 'boolean') return null
  if (typeof fee === 'object') return null

  if (typeof fee === 'number') {
    return Number.isFinite(fee) ? fee : null
  }

  if (typeof fee === 'string') {
    const trimmed = fee.trim()
    if (!trimmed) return null
    // Allow optional leading + and a single decimal point only.
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

/**
 * Round to business currency precision (2 decimal places) using banker's-safe
 * cents rounding via integer math.
 */
export const normalizeFee = (fee) => {
  const numeric = coerceNumericFee(fee)
  if (numeric == null) {
    throw new PricingError('Invalid appointment fee', {
      statusCode: 400,
      code: 'invalid_fee',
    })
  }

  const factor = 10 ** FEE_PRECISION
  return Math.round(numeric * factor) / factor
}

/**
 * Validate and normalize a doctor appointment fee.
 * @returns {{ ok: true, fee: number, currency: string }}
 */
export const validateDoctorFee = (fee) => {
  const numeric = coerceNumericFee(fee)
  if (numeric == null) {
    throw new PricingError('Invalid appointment fee', {
      statusCode: 400,
      code: 'invalid_fee',
    })
  }

  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    throw new PricingError('Invalid appointment fee', {
      statusCode: 400,
      code: 'invalid_fee',
    })
  }

  if (numeric <= 0) {
    throw new PricingError('Invalid appointment fee', {
      statusCode: 400,
      code: 'invalid_fee',
    })
  }

  const { min, max } = getFeeLimits()
  const normalized = normalizeFee(numeric)

  if (normalized < min || normalized > max) {
    throw new PricingError('Invalid appointment fee', {
      statusCode: 400,
      code: 'fee_out_of_range',
    })
  }

  return {
    ok: true,
    fee: normalized,
    currency: getConfiguredCurrency(),
  }
}

/**
 * Derive the appointment charge from the doctor's current validated fee.
 * Never trust client-supplied amounts.
 */
export const calculateAppointmentAmount = (doctor) => {
  if (!doctor) {
    throw new PricingError('Doctor not found', {
      statusCode: 404,
      code: 'doctor_not_found',
    })
  }

  const { fee, currency } = validateDoctorFee(doctor.fees)
  return {
    amount: fee,
    currency: normalizeCurrency(currency),
  }
}

/**
 * Convert major-unit amount (e.g. 2000.50 PKR) to Stripe minor units (cents).
 */
export const toStripeAmountCents = (amountMajor) => {
  const numeric = coerceNumericFee(amountMajor)
  if (numeric == null || numeric <= 0) {
    throw new PricingError('Invalid appointment fee', {
      statusCode: 400,
      code: 'invalid_fee',
    })
  }
  return Math.round(normalizeFee(numeric) * 100)
}

/**
 * Verify Stripe session amount_total (minor units) against stored appointment amount.
 */
export const validateStripeAmount = ({
  stripeAmountTotal,
  appointmentAmount,
  stripeCurrency,
  appointmentCurrency,
} = {}) => {
  let expectedCents
  try {
    expectedCents = toStripeAmountCents(appointmentAmount)
  } catch {
    logPricing('error', 'Stripe amount mismatch', {
      expectedAmount: appointmentAmount,
      receivedAmount: stripeAmountTotal,
      reason: 'invalid_appointment_amount',
    })
    return {
      ok: false,
      code: 'amount_mismatch',
      message: 'Payment amount mismatch',
      expectedAmount: appointmentAmount,
      receivedAmount: stripeAmountTotal,
    }
  }

  const received = Number(stripeAmountTotal)
  if (!Number.isFinite(received) || received !== expectedCents) {
    logPricing('error', 'Stripe amount mismatch', {
      expectedAmount: appointmentAmount,
      expectedCents,
      receivedAmount: stripeAmountTotal,
    })
    return {
      ok: false,
      code: 'amount_mismatch',
      message: 'Payment amount mismatch',
      expectedAmount: appointmentAmount,
      receivedAmount: stripeAmountTotal,
    }
  }

  const expectedCurrency = normalizeCurrency(
    appointmentCurrency || getConfiguredCurrency()
  )
  if (!currenciesMatch(stripeCurrency, expectedCurrency)) {
    logPricing('error', 'Stripe currency mismatch', {
      expectedCurrency,
      receivedCurrency: stripeCurrency,
    })
    return {
      ok: false,
      code: 'currency_mismatch',
      message: 'Payment currency mismatch',
      expectedCurrency,
      receivedCurrency: stripeCurrency,
    }
  }

  return {
    ok: true,
    expectedCents,
    currency: toStripeCurrency(expectedCurrency),
  }
}

/**
 * Persist a doctor fee change with ownership checks and audit history.
 */
export const updateDoctorFee = async ({
  doctorId,
  targetDoctorId = null,
  newFee,
  changedBy,
  changedByRole,
  transaction = null,
} = {}) => {
  if (!doctorId) {
    throw new PricingError('Doctor ID required', {
      statusCode: 400,
      code: 'missing_doctor',
    })
  }

  // Doctors may only update their own fee.
  if (
    changedByRole === 'doctor' &&
    targetDoctorId != null &&
    String(targetDoctorId) !== String(doctorId)
  ) {
    throw new PricingError('Forbidden', {
      statusCode: 403,
      code: 'forbidden_fee_update',
    })
  }

  const effectiveDoctorId =
    changedByRole === 'admin' && targetDoctorId ? targetDoctorId : doctorId

  if (
    changedByRole === 'doctor' &&
    String(effectiveDoctorId) !== String(changedBy)
  ) {
    throw new PricingError('Forbidden', {
      statusCode: 403,
      code: 'forbidden_fee_update',
    })
  }

  const { fee: normalizedFee } = validateDoctorFee(newFee)

  const doctor = await Doctor.findByPk(effectiveDoctorId, {
    transaction,
    attributes: { exclude: [] },
  })
  if (!doctor) {
    throw new PricingError('Doctor not found', {
      statusCode: 404,
      code: 'doctor_not_found',
    })
  }

  const oldFee = normalizeFee(doctor.fees)

  if (oldFee === normalizedFee) {
    return { doctor, oldFee, newFee: normalizedFee, changed: false }
  }

  await doctor.update({ fees: normalizedFee }, { transaction })

  await DoctorPriceHistory.create(
    {
      doctorId: doctor.id,
      oldFee,
      newFee: normalizedFee,
      changedBy: String(changedBy),
      changedByRole: String(changedByRole || 'unknown'),
    },
    { transaction }
  )

  logPricing('info', 'Doctor fee updated', {
    doctorId: doctor.id,
    oldFee,
    newFee: normalizedFee,
    actor: changedBy,
    actorRole: changedByRole,
  })

  return { doctor, oldFee, newFee: normalizedFee, changed: true }
}
