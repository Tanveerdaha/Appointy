import React, { useContext } from 'react'
import { assets } from '../assets/assets'
import { DoctorContext } from '../context/doctorContext'
import { AdminContext } from '../context/adminContext'
import { useNavigate, useLocation } from 'react-router-dom'

const Navbar = ({ onMenuOpen }) => {
  const { setDToken } = useContext(DoctorContext)
  const { setAToken } = useContext(AdminContext)
  const navigate = useNavigate()
  const location = useLocation()
  const patientUrl = import.meta.env.VITE_PATIENT_URL || 'http://localhost:5173'

  const isAdmin = !!(localStorage.getItem('aToken'))

  const logout = () => {
    localStorage.removeItem('dToken')
    localStorage.removeItem('aToken')
    setDToken('')
    setAToken('')
    navigate('/', { replace: true })
  }

  const isOnDashboard = location.pathname === '/admin-dashboard' || location.pathname === '/doctor-dashboard'

  return (
    <div className='flex justify-between items-center px-4 sm:px-10 py-3 border-b bg-white gap-2'>
      <div className='flex items-center gap-2 sm:gap-3 text-xs flex-1 min-w-0'>
        <button type='button' className='md:hidden p-1' onClick={onMenuOpen} aria-label='Open menu'>
          <img className='w-6' src={assets.add_icon} alt="" />
        </button>
        <img onClick={() => navigate('/')} className='w-28 sm:w-36 cursor-pointer flex-shrink-0' src={assets.admin_logo} alt="Logo" />
        <p className='border px-2 py-0.5 rounded-full border-gray-500 text-gray-600 flex-shrink-0'>
          {isAdmin ? 'Admin' : 'Doctor'}
        </p>
        {isOnDashboard && (
          <button onClick={() => window.open(patientUrl, '_blank')} className='hidden sm:block text-white bg-primary hover:bg-gray-700 px-3 py-1.5 rounded-full text-xs flex-shrink-0'>
            User Panel
          </button>
        )}
      </div>
      <button type='button' onClick={logout} className='bg-primary text-white text-xs sm:text-sm px-4 sm:px-8 py-2 rounded-full flex-shrink-0 cursor-pointer'>
        Logout
      </button>
    </div>
  )
}

export default Navbar
