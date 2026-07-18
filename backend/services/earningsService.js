import { Op } from 'sequelize'
import { Appointment, StripePayment } from '../models/index.js'
import {
  PAYMENT_STATUS,
  PAID_LIKE_STATUSES,
} from '../models/stripePaymentModel.js'

/**
 * Ledger statuses that represent money successfully collected
 * (including in-flight / failed refunds and fully/partially refunded rows).
 */
export const COLLECTED_PAYMENT_STATUSES = [
  ...PAID_LIKE_STATUSES,
  PAYMENT_STATUS.REFUNDED,
]

/**
 * Convert Stripe minor units (cents) to major currency units for dashboard display.
 */
export const fromStripeAmountMajor = (cents) => {
  const n = Number(cents)
  if (!Number.isFinite(n)) return 0
  return Math.round(n) / 100
}

/**
 * Net retained amount for a single ledger row (minor units).
 * Confirmed refunds subtract refundAmount; pending/failed refunds do not.
 */
export const netCollectedCentsForPayment = (payment) => {
  const amount = Number(payment?.amount) || 0
  if (payment?.status === PAYMENT_STATUS.REFUNDED) {
    const refunded = Number(payment.refundAmount) || 0
    return amount - refunded
  }
  return amount
}

/**
 * Successfully collected payments minus confirmed refunds.
 * Optional docId scopes to one doctor's appointments via the appointment join.
 *
 * @returns {{ netCollectedMajor: number, paidAppointmentCount: number }}
 */
export const getNetCollectedMajor = async ({ docId } = {}) => {
  const include = []
  if (docId) {
    include.push({
      model: Appointment,
      attributes: [],
      required: true,
      where: { docId },
    })
  }

  const rows = await StripePayment.findAll({
    attributes: ['appointmentId', 'amount', 'refundAmount', 'status'],
    where: {
      status: { [Op.in]: COLLECTED_PAYMENT_STATUSES },
    },
    include,
    raw: true,
  })

  const netByAppointment = new Map()
  for (const row of rows) {
    const appointmentId = row.appointmentId
    const prev = netByAppointment.get(appointmentId) || 0
    netByAppointment.set(appointmentId, prev + netCollectedCentsForPayment(row))
  }

  let netCents = 0
  let paidAppointmentCount = 0
  for (const net of netByAppointment.values()) {
    netCents += net
    if (net > 0) paidAppointmentCount += 1
  }

  return {
    netCollectedMajor: fromStripeAmountMajor(netCents),
    paidAppointmentCount,
  }
}
