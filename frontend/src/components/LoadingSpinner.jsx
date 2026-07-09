import React from 'react'

const LoadingSpinner = ({ label = 'Loading...' }) => (
  <div className='flex flex-col items-center justify-center py-16 gap-3'>
    <div className='w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin' />
    <p className='text-sm text-gray-500'>{label}</p>
  </div>
)

export default LoadingSpinner
