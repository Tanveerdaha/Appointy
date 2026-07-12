import axios from 'axios'

export const redirectToStripeCheckout = (sessionUrl) => {
  if (!sessionUrl) {
    throw new Error('Missing Stripe checkout URL')
  }
  window.location.assign(sessionUrl)
}

export const verifyStripePayment = async (backendUrl, token, sessionId) => {
  const { data } = await axios.post(
    `${backendUrl}/api/user/verify-stripe`,
    { sessionId },
    { headers: { token, Authorization: `Bearer ${token}` } }
  )
  return data
}

export const getPaymentStatus = (item) => {
  if (item.paymentStatus) return item.paymentStatus
  return item.payment ? 'paid' : 'unpaid'
}
