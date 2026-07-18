import React, { useEffect } from 'react'
import { assets } from '../../assets/assets'
import { useContext } from 'react'
import { AdminContext } from '../../context/adminContext'
import { AppContext } from '../../context/appContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import { getPaymentLabel, isAppointmentCancelled, isAppointmentCompleted } from '../../utils/payment'

const AllAppointments = () => {
  const { aToken, appointments, cancelAppointment, completeAppointment, getAllAppointments } = useContext(AdminContext)
  const { calculateAge, slotDateFormat, currency, getId } = useContext(AppContext)

  useEffect(() => {
    if (aToken) getAllAppointments()
  }, [aToken, getAllAppointments])

  if (!appointments) return <LoadingSpinner label='Loading appointments...' />

  return (
    <div className='w-full max-w-6xl m-5'>
      <p className='mb-3 text-lg font-medium'>All Appointments</p>
      {appointments.length === 0 ? (
        <EmptyState title='No appointments' />
      ) : (
        <div className='bg-white border rounded text-sm max-h-[80vh] overflow-y-scroll'>
          <div className='hidden sm:grid grid-cols-[0.5fr_3fr_1fr_3fr_3fr_1fr_1fr_1fr] py-3 px-6 border-b'>
            <p>#</p>
            <p>Patient</p>
            <p>Age</p>
            <p>Date & Time</p>
            <p>Doctor</p>
            <p>Fees</p>
            <p>Payment</p>
            <p>Action</p>
          </div>
          {appointments.map((item, index) => (
            <div className='flex flex-wrap gap-2 sm:grid sm:grid-cols-[0.5fr_3fr_1fr_3fr_3fr_1fr_1fr_1fr] items-center text-gray-500 py-3 px-6 border-b hover:bg-gray-50' key={getId(item)}>
              <p className='max-sm:hidden'>{index + 1}</p>
              <div className='flex items-center gap-2 w-full sm:w-auto'>
                <span className='sm:hidden text-xs font-medium'>Patient:</span>
                <img src={item.userData.image} className='w-8 rounded-full' alt="" />
                <p>{item.userData.name}</p>
              </div>
              <p className='max-sm:hidden'>{calculateAge(item.userData.dob)}</p>
              <p><span className='sm:hidden text-xs font-medium'>When: </span>{slotDateFormat(item.slotDate)} {item.slotTime}</p>
              <div className='flex items-center gap-2'>
                <span className='sm:hidden text-xs font-medium'>Doctor:</span>
                <img src={item.docData.image} className='w-8 rounded-full bg-gray-200' alt="" />
                <p>{item.docData.name}</p>
              </div>
              <p><span className='sm:hidden text-xs font-medium'>Fees: </span>{currency}{item.amount}</p>
              <p className={`text-xs font-medium ${getPaymentLabel(item) === 'Paid' ? 'text-green-600' : getPaymentLabel(item).includes('Refund') ? 'text-amber-600' : 'text-gray-500'}`}>
                <span className='sm:hidden'>Payment: </span>{getPaymentLabel(item)}
              </p>
              {isAppointmentCancelled(item) ? <p className='text-red-400 text-xs font-medium'>Cancelled</p>
                : isAppointmentCompleted(item) ? <p className='text-green-500 text-xs font-medium'>Completed</p> :
                  <div className='flex'>
                    <img onClick={() => completeAppointment(getId(item))} className='w-10 cursor-pointer' src={assets.tick_icon} alt="Complete" />
                    <img onClick={() => cancelAppointment(getId(item), { paymentStatus: item.paymentStatus || (item.payment ? 'paid' : 'unpaid') })} className='w-10 cursor-pointer' src={assets.cancel_icon} alt="Cancel" />
                  </div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AllAppointments
