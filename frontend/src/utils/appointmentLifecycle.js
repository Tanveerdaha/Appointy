/**
 * Appointment lifecycle helpers for UI action visibility.
 * Canonical source of truth: item.status
 */

export const APPOINTMENT_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
}

export const getAppointmentStatus = (item) => {
  if (item?.status) return item.status
  // Temporary fallback for stale payloads during migration.
  if (item?.isCompleted) return APPOINTMENT_STATUS.COMPLETED
  if (item?.cancelled) return APPOINTMENT_STATUS.CANCELLED
  return APPOINTMENT_STATUS.CONFIRMED
}

export const isCompletedStatus = (status) => status === APPOINTMENT_STATUS.COMPLETED

export const isCancelledStatus = (status) =>
  status === APPOINTMENT_STATUS.CANCELLED || status === APPOINTMENT_STATUS.NO_SHOW

export const isTerminalAppointmentStatus = (status) =>
  isCompletedStatus(status) || isCancelledStatus(status)

export const canPayAppointment = (status, paymentStatus) =>
  !isTerminalAppointmentStatus(status) && paymentStatus !== 'paid' && paymentStatus !== 'refunded'

export const canShowPaidBadge = (status, paymentStatus) =>
  !isTerminalAppointmentStatus(status) && paymentStatus === 'paid'

export const canRescheduleAppointment = (status) => status === APPOINTMENT_STATUS.CONFIRMED

export const canCancelAppointment = (status, paymentStatus) =>
  !isTerminalAppointmentStatus(status) &&
  paymentStatus !== 'paid' &&
  paymentStatus !== 'refunded'

export const getLifecycleActions = (item, paymentStatus) => {
  const status = getAppointmentStatus(item)
  return {
    status,
    showPay: canPayAppointment(status, paymentStatus),
    showPaid: canShowPaidBadge(status, paymentStatus),
    showCompleted: isCompletedStatus(status),
    showCancelled: isCancelledStatus(status) && !isCompletedStatus(status),
    showReschedule: canRescheduleAppointment(status),
    showCancel: canCancelAppointment(status, paymentStatus),
  }
}
