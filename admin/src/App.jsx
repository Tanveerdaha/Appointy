import React, { useContext, useEffect, useState } from 'react'
import axios from 'axios'
import { DoctorContext } from '../context/DoctorContext'
import { AdminContext } from '../context/AdminContext'
import { Route, Routes, Navigate, useLocation } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Admin/Dashboard'
import AllAppointments from './pages/Admin/AllAppointments'
import PatientsList from './pages/Admin/PatientsList'
import AddDoctor from './pages/Admin/AddDoctor'
import DoctorsList from './pages/Admin/DoctorsList'
import Login from './pages/Login'
import DoctorAppointments from './pages/Doctor/DoctorAppointments'
import DoctorDashboard from './pages/Doctor/DoctorDashboard'
import DoctorProfile from './pages/Doctor/DoctorProfile'

const App = () => {
  const { dToken } = useContext(DoctorContext)
  const { aToken } = useContext(AdminContext)
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  axios.interceptors.request.use((config) => {
    const at = localStorage.getItem('aToken')
    const dt = localStorage.getItem('dToken')
    if (at) {
      config.headers.atoken = at
      config.headers.Authorization = `Bearer ${at}`
    } else if (dt) {
      config.headers.dtoken = dt
      config.headers.Authorization = `Bearer ${dt}`
    }
    return config
  })

  if (location.pathname === '/') {
    if (aToken) return <Navigate to="/admin-dashboard" replace />
    if (dToken) return <Navigate to="/doctor-dashboard" replace />
  }

  const Layout = ({ children }) => (
    <div className='bg-[#F8F9FD]'>
      <ToastContainer />
      <Navbar onMenuOpen={() => setMobileOpen(true)} />
      <div className='flex items-start'>
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className='flex-1 min-w-0'>{children}</div>
      </div>
    </div>
  )

  if (aToken) {
    return (
      <Layout>
        <Routes>
          <Route path="/admin-dashboard" element={<Dashboard />} />
          <Route path="/all-appointments" element={<AllAppointments />} />
          <Route path="/patients-list" element={<PatientsList />} />
          <Route path="/add-doctor" element={<AddDoctor />} />
          <Route path="/doctor-list" element={<DoctorsList />} />
          <Route path="*" element={<Navigate to="/admin-dashboard" />} />
        </Routes>
      </Layout>
    )
  }

  if (dToken) {
    return (
      <Layout>
        <Routes>
          <Route path="/doctor-dashboard" element={<DoctorDashboard />} />
          <Route path="/doctor-appointments" element={<DoctorAppointments />} />
          <Route path="/doctor-profile" element={<DoctorProfile />} />
          <Route path="*" element={<Navigate to="/doctor-dashboard" />} />
        </Routes>
      </Layout>
    )
  }

  return (
    <>
      <ToastContainer />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </>
  )
}

export default App
