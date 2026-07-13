export const getPaymentLabel = (item) => {
  const status = item.paymentStatus || (item.payment ? 'paid' : 'unpaid')
  if (status === 'paid') return 'Paid'
  if (status === 'pending') return 'Pending'
  return 'Unpaid'
}
