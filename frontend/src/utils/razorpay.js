import axios from 'axios'

export const openRazorpayCheckout = ({ order, key, onSuccess, onError }) => {
  const options = {
    key,
    amount: order.amount,
    currency: order.currency,
    name: 'Appointment Payment',
    description: 'Appointment Payment',
    order_id: order.id,
    receipt: order.receipt,
    handler: onSuccess,
  }
  const rzp = new window.Razorpay(options)
  rzp.on('payment.failed', onError)
  rzp.open()
}

export const verifyPayment = async (backendUrl, token, response) => {
  const { data } = await axios.post(`${backendUrl}/api/user/verifyRazorpay`, response, {
    headers: { token, Authorization: `Bearer ${token}` },
  })
  return data
}

export const getPaymentStatus = (item) => {
  if (item.paymentStatus) return item.paymentStatus
  return item.payment ? 'paid' : 'unpaid'
}
