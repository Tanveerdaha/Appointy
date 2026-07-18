export const getPaymentLabel = (item) => {
  const status = item.paymentStatus || (item.payment ? 'paid' : 'unpaid')
  if (status === 'paid') return 'Paid'
  if (status === 'pending') return 'Pending'
  if (status === 'refund_pending') return 'Refund Processing'
  if (status === 'refunded') return 'Refunded'
  if (status === 'refund_failed') return 'Refund Failed'
  return 'Unpaid'
}

export const isAppointmentCancelled = (item) =>
  item?.status === 'CANCELLED' || item?.status === 'NO_SHOW' || item?.cancelled === true

export const isAppointmentCompleted = (item) =>
  item?.status === 'COMPLETED' || item?.isCompleted === true
