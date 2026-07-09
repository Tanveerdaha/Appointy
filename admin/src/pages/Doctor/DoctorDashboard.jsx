import React from 'react'
import { useContext } from 'react'
import { useEffect } from 'react'
import { DoctorContext } from '../../context/doctorContext'
import { assets } from '../../assets/assets'
import { AppContext } from '../../context/appContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'

const DoctorDashboard = () => {
  const { dToken, dashData, getDashData, cancelAppointment, completeAppointment } = useContext(DoctorContext)
  const { slotDateFormat, currency, getId } = useContext(AppContext)

  useEffect(() => {
    if (dToken) getDashData()
  }, [dToken, getDashData])

  if (!dashData) return <LoadingSpinner label='Loading dashboard...' />

  const latest = dashData.latestAppointments || []

  return (
    <div className='m-5'>
      <div className='flex flex-wrap gap-3'>
        <div className='flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100'>
          <img className='w-14' src={assets.earning_icon} alt="" />
          <div>
            <p className='text-xl font-semibold text-gray-600'>{currency} {dashData.earnings}</p>
            <p className='text-gray-400'>Earnings</p>
          </div>
        </div>
        <div className='flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100'>
          <img className='w-14' src={assets.appointments_icon} alt="" />
          <div>
            <p className='text-xl font-semibold text-gray-600'>{dashData.appointments}</p>
            <p className='text-gray-400'>Appointments</p>
          </div>
        </div>
        <div className='flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100'>
          <img className='w-14' src={assets.patients_icon} alt="" />
          <div>
            <p className='text-xl font-semibold text-gray-600'>{dashData.patients}</p>
            <p className='text-gray-400'>Patients</p>
          </div>
        </div>
      </div>

      <div className='bg-white mt-10'>
        <div className='flex items-center gap-2.5 px-4 py-4 rounded-t border'>
          <img src={assets.list_icon} alt="" />
          <p className='font-semibold'>Latest Bookings</p>
        </div>
        {latest.length === 0 ? (
          <EmptyState title='No appointments yet' />
        ) : (
          <div className='pt-4 border border-t-0'>
            {latest.slice(0, 5).map((item) => (
              <div className='flex items-center px-6 py-3 gap-3 hover:bg-gray-100' key={getId(item)}>
                <img className='rounded-full w-10' src={item.userData.image} alt="" />
                <div className='flex-1 text-sm'>
                  <p className='text-gray-800 font-medium'>{item.userData.name}</p>
                  <p className='text-gray-600'>Booking on {slotDateFormat(item.slotDate)}</p>
                </div>
                {item.cancelled ? <p className='text-red-400 text-xs font-medium'>Cancelled</p>
                  : item.isCompleted ? <p className='text-green-500 text-xs font-medium'>Completed</p>
                    : <div className='flex'>
                      <img onClick={() => cancelAppointment(getId(item))} className='w-10 cursor-pointer' src={assets.cancel_icon} alt="Cancel" />
                      <img onClick={() => completeAppointment(getId(item))} className='w-10 cursor-pointer' src={assets.tick_icon} alt="Complete" />
                    </div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DoctorDashboard
