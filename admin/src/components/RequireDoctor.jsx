import { useContext } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { DoctorContext } from '../context/doctorContext'

const RequireDoctor = () => {
  const { dToken } = useContext(DoctorContext)
  const stored = localStorage.getItem('dToken')
  const isAuthed = !!(dToken || stored)

  if (!isAuthed) {
    return <Navigate to='/' replace />
  }

  return <Outlet />
}

export default RequireDoctor
