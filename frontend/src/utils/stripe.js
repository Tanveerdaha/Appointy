import api from '../api/client'

export const redirectToStripeCheckout = (sessionUrl) => {
  if (!sessionUrl) {
    throw new Error('Missing Stripe checkout URL')
  }
  window.location.assign(sessionUrl)
}

export const verifyStripePayment = async (_backendUrl, _token, sessionId) => {
  const { data } = await api.post('/api/user/verify-stripe', { sessionId })
  return data
}

// Read current payment status (and any active checkout URL) for an appointment
// so the UI can resume an in-flight payment instead of creating a new one.
export const fetchPaymentStatus = async (appointmentId) => {
  const { data } = await api.get(`/api/user/payment-status/${appointmentId}`)
  return data
}

export const getPaymentStatus = (item) => {
  if (item.paymentStatus) return item.paymentStatus
  return item.payment ? 'paid' : 'unpaid'
}
