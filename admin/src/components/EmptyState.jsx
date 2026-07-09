import React from 'react'

const EmptyState = ({ title, message }) => (
  <div className='flex flex-col items-center justify-center py-16 text-center text-gray-500 m-5'>
    <p className='text-lg font-medium text-gray-700'>{title}</p>
    {message && <p className='text-sm mt-2'>{message}</p>}
  </div>
)

export default EmptyState
