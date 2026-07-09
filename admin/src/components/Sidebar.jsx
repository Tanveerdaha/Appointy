import React, { useState } from 'react'
import { assets } from '../assets/assets'
import { NavLink } from 'react-router-dom'
import { DoctorContext } from '../context/DoctorContext'
import { AdminContext } from '../context/AdminContext'
import { useContext } from 'react'

const adminLinks = [
  { to: '/admin-dashboard', icon: assets.home_icon, label: 'Dashboard' },
  { to: '/all-appointments', icon: assets.appointment_icon, label: 'Appointments' },
  { to: '/patients-list', icon: assets.patients_icon, label: 'Patients' },
  { to: '/add-doctor', icon: assets.add_icon, label: 'Add Doctor' },
  { to: '/doctor-list', icon: assets.people_icon, label: 'Doctors List' },
]

const doctorLinks = [
  { to: '/doctor-dashboard', icon: assets.home_icon, label: 'Dashboard' },
  { to: '/doctor-appointments', icon: assets.appointment_icon, label: 'Appointments' },
  { to: '/doctor-profile', icon: assets.people_icon, label: 'Profile' },
]

const Sidebar = ({ mobileOpen, onClose }) => {
  const { dToken } = useContext(DoctorContext)
  const { aToken } = useContext(AdminContext)
  const links = aToken ? adminLinks : doctorLinks

  return (
    <>
      {mobileOpen && (
        <div className='fixed inset-0 bg-black/40 z-30 md:hidden' onClick={onClose} />
      )}
      <div className={`fixed md:static z-40 min-h-screen bg-white border-r transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <ul className='text-[#515151] mt-5'>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={onClose}
              title={link.label}
              className={({ isActive }) => `flex items-center gap-3 py-3.5 px-3 md:px-9 md:min-w-56 cursor-pointer ${isActive ? 'bg-[#F2F3FF] border-r-4 border-primary' : ''}`}
            >
              <img className='min-w-5' src={link.icon} alt="" />
              <p className='md:block'>{link.label}</p>
            </NavLink>
          ))}
        </ul>
      </div>
    </>
  )
}

export default Sidebar
