import { useContext } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { AdminContext } from '../context/adminContext'
import { DoctorContext } from '../context/doctorContext'

const GuestOnly = () => {
  const { aToken } = useContext(AdminContext)
  const { dToken } = useContext(DoctorContext)

  if (aToken || localStorage.getItem('aToken')) {
    return <Navigate to='/admin-dashboard' replace />
  }
  if (dToken || localStorage.getItem('dToken')) {
    return <Navigate to='/doctor-dashboard' replace />
  }

  return <Outlet />
}

export default GuestOnly
