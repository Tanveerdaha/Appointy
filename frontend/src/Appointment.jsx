import React, { useContext, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppContext } from './context/appContext'
import { assets } from './assets/assets'
import RelatedDoctors from './components/RelatedDoctors'
import LoadingSpinner from './components/LoadingSpinner'
import EmptyState from './components/EmptyState'
import useAvailableSlots from './hooks/useAvailableSlots'
import axios from 'axios'
import { toast } from 'react-toastify'
import { openRazorpayCheckout, verifyPayment } from './utils/razorpay'

const Appointment = () => {
  const { docId } = useParams()
  const navigate = useNavigate()
  const { doctors, currencySymbol, backendUrl, token, getDoctorsData } = useContext(AppContext)

  const [docInfo, setDocInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [slotIndex, setSlotIndex] = useState(0)
  const [slotTime, setSlotTime] = useState('')
  const [payMode, setPayMode] = useState('later')
  const [booking, setBooking] = useState(false)

  const { docSlots, daysOfWeek } = useAvailableSlots(docInfo)

  useEffect(() => {
    if (doctors.length > 0) {
      const doc = doctors.find((d) => (d.id || d._id) === docId)
      if (doc) {
        setDocInfo({ ...doc, slots_booked: doc.slots_booked || {} })
      } else {
        setDocInfo(null)
      }
      setLoading(false)
    }
  }, [doctors, docId])

  const handlePayment = async (order) => {
    const key = import.meta.env.VITE_RAZORPAY_KEY_ID
    if (!key) {
      toast.error('Razorpay key not configured')
      return
    }
    openRazorpayCheckout({
      order,
      key,
      onSuccess: async (response) => {
        try {
          const data = await verifyPayment(backendUrl, token, response)
          if (data.success) {
            toast.success(data.message)
            getDoctorsData()
            navigate('/my-appointments')
          } else {
            toast.error(data.message)
          }
        } catch (error) {
          toast.error(error.message)
        }
      },
      onError: () => toast.error('Payment failed'),
    })
  }

  const bookAppointment = async () => {
    if (!token) {
      toast.warning('Login to book appointment')
      return navigate('/login')
    }

    if (!docInfo?.available) {
      toast.error('Doctor is not available for booking')
      return
    }

    if (!slotTime) {
      toast.warning('Please select a time slot')
      return
    }

    const selectedDay = docSlots[slotIndex]
    if (!selectedDay?.length) {
      toast.warning('No slots available for the selected day')
      return
    }

    const date = selectedDay[0].datetime
    const slotDate = `${date.getDate()}_${date.getMonth() + 1}_${date.getFullYear()}`

    try {
      setBooking(true)
      const { data } = await axios.post(
        `${backendUrl}/api/user/book-appointment`,
        { docId, slotDate, slotTime, payMode },
        { headers: { token, Authorization: `Bearer ${token}` } }
      )

      if (data.success) {
        toast.success(data.message)
        if (payMode === 'now' && data.order) {
          await handlePayment(data.order)
        } else {
          getDoctorsData()
          navigate('/my-appointments')
        }
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    } finally {
      setBooking(false)
    }
  }

  if (loading) return <LoadingSpinner label='Loading doctor details...' />

  if (!docInfo) {
    return (
      <EmptyState
        title='Doctor not found'
        message='The doctor you are looking for does not exist or has been removed.'
        actionLabel='Browse Doctors'
        onAction={() => navigate('/doctors')}
      />
    )
  }

  return (
    <div>
      <div className='flex flex-col sm:flex-row gap-4'>
        <div>
          <img className='bg-primary w-full sm:max-w-72 rounded-lg' src={docInfo.image} alt={docInfo.name} />
        </div>
        <div className='flex-1 border border-[#ADADAD] rounded-lg p-8 py-7 bg-white mx-2 sm:mx-0 mt-[-80px] sm:mt-0'>
          <p className='flex items-center gap-2 text-3xl font-medium text-gray-700'>
            {docInfo.name} <img src={assets.verified_icon} alt="" />
          </p>
          <div className='flex items-center gap-2 mt-1 text-gray-600'>
            <p>{docInfo.degree} - {docInfo.speciality}</p>
            <button className='py-0.5 px-2 border text-xs rounded-full'>{docInfo.experience}</button>
          </div>
          {!docInfo.available && (
            <p className='mt-3 text-red-500 text-sm font-medium'>This doctor is currently not accepting appointments.</p>
          )}
          <div>
            <p className='flex items-center gap-1 text-sm font-medium text-[#262626] mt-3'>
              About <img src={assets.info_icon} alt="" />
            </p>
            <p className='text-sm text-gray-600 max-w-[700px] mt-1'>{docInfo.about}</p>
          </div>
          <p className='text-gray-600 font-medium mt-4'>
            Appointment fee: <span className='text-gray-800'>{currencySymbol} {docInfo.fees}</span>
          </p>
        </div>
      </div>

      {docInfo.available && (
        <div className='sm:ml-72 sm:pl-4 mt-8 font-medium text-[#565656]'>
          <p>Booking slots</p>

          <div className='flex gap-3 items-center w-full overflow-x-scroll mt-4'>
            {docSlots.map((item, index) => (
              <div
                onClick={() => setSlotIndex(index)}
                key={index}
                className={`text-center py-6 min-w-16 rounded-full cursor-pointer ${slotIndex === index ? 'bg-primary text-white' : 'border border-[#DDDDDD]'}`}
              >
                <p>{item[0] && daysOfWeek[item[0].datetime.getDay()]}</p>
                <p>{item[0] && item[0].datetime.getDate()}</p>
              </div>
            ))}
          </div>

          <div className='flex items-center gap-3 w-full overflow-x-scroll mt-4'>
            {docSlots[slotIndex]?.map((item, index) => (
              <p
                onClick={() => setSlotTime(item.time)}
                key={index}
                className={`text-sm font-light flex-shrink-0 px-5 py-2 rounded-full cursor-pointer ${item.time === slotTime ? 'bg-primary text-white' : 'text-[#949494] border border-[#B4B4B4]'}`}
              >
                {item.time.toLowerCase()}
              </p>
            ))}
          </div>

          <div className='mt-6 flex flex-col sm:flex-row gap-4'>
            <label className='flex items-center gap-2 cursor-pointer'>
              <input type='radio' name='payMode' checked={payMode === 'later'} onChange={() => setPayMode('later')} />
              Pay later at clinic
            </label>
            <label className='flex items-center gap-2 cursor-pointer'>
              <input type='radio' name='payMode' checked={payMode === 'now'} onChange={() => setPayMode('now')} />
              Pay now online
            </label>
          </div>

          <button
            onClick={bookAppointment}
            disabled={!slotTime || booking}
            className={`text-white text-sm font-light px-20 py-3 rounded-full my-6 ${slotTime && !booking ? 'bg-primary' : 'bg-gray-400 cursor-not-allowed'}`}
          >
            {booking ? 'Booking...' : payMode === 'now' ? 'Book & Pay Now' : 'Book an appointment'}
          </button>
        </div>
      )}

      <RelatedDoctors speciality={docInfo.speciality} docId={docId} />
    </div>
  )
}

export default Appointment
