import React from 'react'
import { useNavigate } from 'react-router-dom'

const NotFound = () => {
  const navigate = useNavigate()
  return (
    <div className='flex flex-col items-center justify-center py-24 text-center'>
      <h1 className='text-6xl font-bold text-primary'>404</h1>
      <p className='text-xl text-gray-600 mt-4'>Page not found</p>
      <p className='text-sm text-gray-500 mt-2'>The page you are looking for does not exist.</p>
      <button onClick={() => navigate('/')} className='mt-6 px-8 py-3 bg-primary text-white rounded-full'>
        Go Home
      </button>
    </div>
  )
}

export default NotFound
