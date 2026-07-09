import { useContext } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { AdminContext } from '../context/AdminContext'

const RequireAdmin = () => {
  const { aToken } = useContext(AdminContext)
  const stored = localStorage.getItem('aToken')
  const isAuthed = !!(aToken || stored)

  if (!isAuthed) {
    return <Navigate to='/' replace />
  }

  return <Outlet />
}

export default RequireAdmin
