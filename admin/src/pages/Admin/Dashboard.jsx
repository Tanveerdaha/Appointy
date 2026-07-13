import React, { useContext, useEffect } from 'react'
import { assets } from '../../assets/assets'
import { AdminContext } from '../../context/adminContext'
import { AppContext } from '../../context/appContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'

const Dashboard = () => {
  const { aToken, getDashData, cancelAppointment, completeAppointment, dashData } = useContext(AdminContext)
  const { slotDateFormat, getId, currency } = useContext(AppContext)

  useEffect(() => {
    if (aToken) getDashData()
  }, [aToken, getDashData])

  if (!dashData) return <LoadingSpinner label='Loading dashboard...' />

  const latest = dashData.latestAppointments || []

  return (
    <div className='m-5'>
      <div className='flex flex-wrap gap-3'>
        <div className='flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100'>
          <img className='w-14' src={assets.doctor_icon} alt="" />
          <div>
            <p className='text-xl font-semibold text-gray-600'>{dashData.doctors}</p>
            <p className='text-gray-400'>Doctors</p>
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
        <div className='flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100'>
          <div className='w-14 h-14 flex items-center justify-center bg-green-50 rounded text-green-600 font-bold text-lg'>{currency}</div>
          <div>
            <p className='text-xl font-semibold text-gray-600'>{currency}{dashData.revenue || 0}</p>
            <p className='text-gray-400'>Revenue ({dashData.paidAppointments || 0} paid)</p>
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
                <img className='rounded-full w-10' src={item.docData.image} alt="" />
                <div className='flex-1 text-sm'>
                  <p className='text-gray-800 font-medium'>{item.docData.name}</p>
                  <p className='text-gray-600'>Booking on {slotDateFormat(item.slotDate)}</p>
                </div>
                {item.cancelled ? <p className='text-red-400 text-xs font-medium'>Cancelled</p> : item.isCompleted ? <p className='text-green-500 text-xs font-medium'>Completed</p> : (
                  <div className='flex'>
                    <img onClick={() => completeAppointment(getId(item))} className='w-10 cursor-pointer' src={assets.tick_icon} alt="Complete" />
                    <img onClick={() => cancelAppointment(getId(item))} className='w-10 cursor-pointer' src={assets.cancel_icon} alt="Cancel" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Dashboard
