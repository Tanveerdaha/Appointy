import React, { useCallback, useContext, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppContext } from '../context/appContext'
import api from '../api/client'
import { toast } from 'react-toastify'
import RescheduleModal from '../components/RescheduleModal'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { redirectToStripeCheckout, verifyStripePayment, getPaymentStatus } from '../utils/stripe'
import { getLifecycleActions } from '../utils/appointmentLifecycle'

const MyAppointments = () => {
  const { token, getDoctorsData, doctors } = useContext(AppContext)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [payingId, setPayingId] = useState('')
  const [rescheduleTarget, setRescheduleTarget] = useState(null)

  const months = [' ', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const slotDateFormat = (slotDate) => {
    const [day, month, year] = slotDate.split('_')
    return `${day} ${months[Number(month)]} ${year}`
  }

  const getUserAppointments = useCallback(async () => {
    try {
      const { data } = await api.get('/api/user/appointments')
      if (data.success) {
        setAppointments([...(data.appointments || [])].reverse())
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const cancelAppointment = async (appointmentId) => {
    try {
      const { data } = await api.post('/api/user/cancel-appointment', { appointmentId })
      if (data.success) {
        toast.success(data.message)
        getUserAppointments()
        getDoctorsData()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    }
  }

  const appointmentStripe = async (appointmentId) => {
    // Guard against double-clicks / concurrent requests from this tab.
    if (payingId) return
    try {
      setPayingId(appointmentId)
      const { data } = await api.post('/api/user/payment-stripe', { appointmentId })
      if (data.success && data.sessionUrl) {
        if (data.existingPayment) {
          toast.info('Payment already started. Redirecting...')
        }
        // Keep the button disabled through the redirect (do not reset payingId).
        redirectToStripeCheckout(data.sessionUrl)
      } else {
        toast.error(data.message || 'Unable to start Stripe checkout')
        setPayingId('')
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
      setPayingId('')
    }
  }

  const rescheduleAppointment = async (payload) => {
    try {
      const { data } = await api.post('/api/user/reschedule-appointment', payload)
      if (data.success) {
        toast.success(data.message)
        setRescheduleTarget(null)
        getUserAppointments()
        getDoctorsData()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    }
  }

  useEffect(() => {
    if (token) getUserAppointments()
  }, [token, getUserAppointments])

  useEffect(() => {
    const sessionId = searchParams.get('session_id')
    const canceled = searchParams.get('canceled')

    if (!token) return

    if (canceled) {
      toast.info('Payment cancelled')
      setSearchParams({})
      return
    }

    if (!sessionId) return

    const confirmPayment = async () => {
      try {
        toast.info('Confirming payment...')
        const result = await verifyStripePayment(null, null, sessionId)
        if (result.success) {
          toast.success(result.message || 'Payment successful')
          getUserAppointments()
        } else {
          toast.error(result.message)
          // Webhook may still finalize payment — refresh list for current status.
          getUserAppointments()
        }
      } catch (error) {
        toast.error(error.response?.data?.message || error.message)
        getUserAppointments()
      } finally {
        setSearchParams({})
      }
    }

    confirmPayment()
  }, [token, searchParams, setSearchParams, getUserAppointments])

  if (loading) return <LoadingSpinner label='Loading appointments...' />

  return (
    <div>
      <p className='pb-3 mt-12 text-lg font-medium text-gray-600 border-b'>My appointments</p>

      {appointments.length === 0 ? (
        <EmptyState
          title='No appointments yet'
          message='Book your first appointment with one of our trusted doctors.'
          actionLabel='Browse Doctors'
          onAction={() => navigate('/doctors')}
        />
      ) : (
        <div>
          {appointments.map((item) => {
            const apptId = item.id || item._id
            const paymentStatus = getPaymentStatus(item)
            const actions = getLifecycleActions(item, paymentStatus)
            return (
              <div key={apptId} className='grid grid-cols-[1fr_2fr] gap-4 sm:flex sm:gap-6 py-4 border-b'>
                <div>
                  <img className='w-36 bg-[#EAEFFF]' src={item.docData.image} alt="" />
                </div>
                <div className='flex-1 text-sm text-[#5E5E5E]'>
                  <p className='text-[#262626] text-base font-semibold'>{item.docData.name}</p>
                  <p>{item.docData.speciality}</p>
                  <p className='text-[#464646] font-medium mt-1'>Address:</p>
                  <p>{item.docData.address.line1}</p>
                  <p>{item.docData.address.line2}</p>
                  <p className='mt-1'>
                    <span className='text-sm text-[#3C3C3C] font-medium'>Date & Time:</span>{' '}
                    {slotDateFormat(item.slotDate)} | {item.slotTime}
                  </p>
                  <p className='text-xs mt-1 text-gray-500'>
                    Payment: {paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'pending' ? 'Pending' : paymentStatus === 'refunded' ? 'Refunded' : 'Unpaid'}
                  </p>
                </div>
                <div />
                <div className='flex flex-col gap-2 justify-end text-sm text-center'>
                  {actions.showPay && (
                    <button
                      onClick={() => appointmentStripe(apptId)}
                      disabled={payingId === apptId}
                      className='text-[#696969] sm:min-w-48 py-2 border rounded hover:bg-primary hover:text-white transition-all duration-300 disabled:opacity-60'
                    >
                      {payingId === apptId ? 'Creating payment...' : 'Pay with Stripe'}
                    </button>
                  )}
                  {actions.showPaid && (
                    <button className='sm:min-w-48 py-2 border rounded text-[#696969] bg-[#EAEFFF]'>Paid</button>
                  )}
                  {actions.showCompleted && (
                    <button className='sm:min-w-48 py-2 border border-green-500 rounded text-green-500'>Completed</button>
                  )}
                  {actions.showReschedule && (
                    <button onClick={() => setRescheduleTarget(item)} className='text-[#696969] sm:min-w-48 py-2 border rounded hover:bg-blue-600 hover:text-white transition-all duration-300'>
                      Reschedule
                    </button>
                  )}
                  {actions.showCancel && (
                    <button onClick={() => cancelAppointment(apptId)} className='text-[#696969] sm:min-w-48 py-2 border rounded hover:bg-red-600 hover:text-white transition-all duration-300'>
                      Cancel appointment
                    </button>
                  )}
                  {actions.showCancelled && (
                    <button className='sm:min-w-48 py-2 border border-red-500 rounded text-red-500'>Appointment cancelled</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {rescheduleTarget && (
        <RescheduleModal
          appointment={rescheduleTarget}
          doctors={doctors}
          onClose={() => setRescheduleTarget(null)}
          onConfirm={rescheduleAppointment}
        />
      )}
    </div>
  )
}

export default MyAppointments
