import React, { useContext, useEffect } from 'react'
import { AdminContext } from '../../context/AdminContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'

const PatientsList = () => {
  const { aToken, patients, getPatients } = useContext(AdminContext)

  useEffect(() => {
    if (aToken) getPatients()
  }, [aToken])

  if (patients === null) return <LoadingSpinner label='Loading patients...' />

  return (
    <div className='m-5'>
      <p className='mb-3 text-lg font-medium'>All Patients</p>
      {patients.length === 0 ? (
        <EmptyState title='No patients registered' />
      ) : (
        <div className='bg-white border rounded text-sm overflow-x-auto'>
          <div className='grid grid-cols-[2fr_2fr_1fr] py-3 px-6 border-b font-medium text-gray-600 min-w-[500px]'>
            <p>Name</p>
            <p>Email</p>
            <p>Phone</p>
          </div>
          {patients.map((user) => (
            <div key={user.id} className='grid grid-cols-[2fr_2fr_1fr] py-3 px-6 border-b hover:bg-gray-50 min-w-[500px]'>
              <p>{user.name}</p>
              <p className='text-gray-500'>{user.email}</p>
              <p>{user.phone}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PatientsList
