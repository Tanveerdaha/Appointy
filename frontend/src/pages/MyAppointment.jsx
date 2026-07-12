import React, { useCallback, useContext, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AppContext } from '../context/appContext'
import axios from 'axios'
import { toast } from 'react-toastify'
import RescheduleModal from '../components/RescheduleModal'
import LoadingSpinner from '../components/LoadingSpinner'
import EmptyState from '../components/EmptyState'
import { redirectToStripeCheckout, verifyStripePayment, getPaymentStatus } from '../utils/stripe'

const MyAppointments = () => {
  const { backendUrl, token, getDoctorsData, doctors } = useContext(AppContext)
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
      const { data } = await axios.get(`${backendUrl}/api/user/appointments`, {
        headers: { token, Authorization: `Bearer ${token}` },
      })
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
  }, [backendUrl, token])

  const cancelAppointment = async (appointmentId) => {
    try {
      const { data } = await axios.post(
        `${backendUrl}/api/user/cancel-appointment`,
        { appointmentId },
        { headers: { token, Authorization: `Bearer ${token}` } }
      )
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
    try {
      setPayingId(appointmentId)
      const { data } = await axios.post(
        `${backendUrl}/api/user/payment-stripe`,
        { appointmentId },
        { headers: { token, Authorization: `Bearer ${token}` } }
      )
      if (data.success && data.sessionUrl) {
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
      const { data } = await axios.post(
        `${backendUrl}/api/user/reschedule-appointment`,
        payload,
        { headers: { token, Authorization: `Bearer ${token}` } }
      )
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
        const result = await verifyStripePayment(backendUrl, token, sessionId)
        if (result.success) {
          toast.success(result.message)
          getUserAppointments()
        } else {
          toast.error(result.message)
        }
      } catch (error) {
        toast.error(error.response?.data?.message || error.message)
      } finally {
        setSearchParams({})
      }
    }

    confirmPayment()
  }, [token, backendUrl, searchParams, setSearchParams, getUserAppointments])

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
            const status = getPaymentStatus(item)
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
                    Payment: {status === 'paid' ? 'Paid' : status === 'pending' ? 'Pending' : 'Unpaid'}
                  </p>
                </div>
                <div />
                <div className='flex flex-col gap-2 justify-end text-sm text-center'>
                  {!item.cancelled && status !== 'paid' && !item.isCompleted && (
                    <button
                      onClick={() => appointmentStripe(apptId)}
                      disabled={payingId === apptId}
                      className='text-[#696969] sm:min-w-48 py-2 border rounded hover:bg-primary hover:text-white transition-all duration-300 disabled:opacity-60'
                    >
                      {payingId === apptId ? 'Redirecting...' : 'Pay with Stripe'}
                    </button>
                  )}
                  {!item.cancelled && status === 'paid' && !item.isCompleted && (
                    <button className='sm:min-w-48 py-2 border rounded text-[#696969] bg-[#EAEFFF]'>Paid</button>
                  )}
                  {item.isCompleted && (
                    <button className='sm:min-w-48 py-2 border border-green-500 rounded text-green-500'>Completed</button>
                  )}
                  {!item.cancelled && !item.isCompleted && (
                    <button onClick={() => setRescheduleTarget(item)} className='text-[#696969] sm:min-w-48 py-2 border rounded hover:bg-blue-600 hover:text-white transition-all duration-300'>
                      Reschedule
                    </button>
                  )}
                  {!item.cancelled && !item.isCompleted && status !== 'paid' && (
                    <button onClick={() => cancelAppointment(apptId)} className='text-[#696969] sm:min-w-48 py-2 border rounded hover:bg-red-600 hover:text-white transition-all duration-300'>
                      Cancel appointment
                    </button>
                  )}
                  {item.cancelled && !item.isCompleted && (
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
