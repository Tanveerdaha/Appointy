/**
 * Appointment lifecycle helpers for UI action visibility.
 * Canonical source of truth: item.status
 * Payment status is separate from appointment status.
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
  !isTerminalAppointmentStatus(status) &&
  paymentStatus !== 'paid' &&
  paymentStatus !== 'refunded' &&
  paymentStatus !== 'refund_pending' &&
  paymentStatus !== 'refund_failed'

export const canShowPaidBadge = (status, paymentStatus) =>
  !isTerminalAppointmentStatus(status) && paymentStatus === 'paid'

export const canRescheduleAppointment = (status) => status === APPOINTMENT_STATUS.CONFIRMED

/** Patients may cancel unpaid or paid appointments (paid → refund workflow). */
export const canCancelAppointment = (status, paymentStatus) =>
  !isTerminalAppointmentStatus(status) &&
  paymentStatus !== 'refunded' &&
  paymentStatus !== 'refund_pending'

export const getPaymentLabel = (paymentStatus) => {
  switch (paymentStatus) {
    case 'paid':
      return 'Paid'
    case 'pending':
      return 'Pending'
    case 'refund_pending':
      return 'Refund Processing'
    case 'refunded':
      return 'Refunded'
    case 'refund_failed':
      return 'Refund Failed'
    default:
      return 'Unpaid'
  }
}

export const getCancelButtonLabel = (paymentStatus) =>
  paymentStatus === 'paid' || paymentStatus === 'refund_failed'
    ? 'Request cancellation/refund'
    : 'Cancel appointment'

export const getLifecycleActions = (item, paymentStatus) => {
  const status = getAppointmentStatus(item)
  const showRefundProcessing =
    paymentStatus === 'refund_pending' ||
    (isCancelledStatus(status) && paymentStatus === 'refund_pending')
  return {
    status,
    showPay: canPayAppointment(status, paymentStatus),
    showPaid: canShowPaidBadge(status, paymentStatus),
    showCompleted: isCompletedStatus(status),
    showCancelled: isCancelledStatus(status) && paymentStatus !== 'refund_pending',
    showRefundProcessing:
      showRefundProcessing ||
      (isCancelledStatus(status) && paymentStatus === 'refund_pending'),
    showRefunded: paymentStatus === 'refunded',
    showReschedule: canRescheduleAppointment(status),
    showCancel: canCancelAppointment(status, paymentStatus),
    cancelLabel: getCancelButtonLabel(paymentStatus),
    paymentLabel: getPaymentLabel(paymentStatus),
  }
}
