import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

const AdminLayout = () => {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className='bg-[#F8F9FD] min-h-screen'>
      <Navbar onMenuOpen={() => setMobileOpen(true)} />
      <div className='flex items-start'>
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <main className='flex-1 min-w-0 w-full'>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AdminLayout
