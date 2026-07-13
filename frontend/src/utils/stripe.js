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

export const getPaymentStatus = (item) => {
  if (item.paymentStatus) return item.paymentStatus
  return item.payment ? 'paid' : 'unpaid'
}
