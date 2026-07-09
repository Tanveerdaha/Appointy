import React from 'react'

const EmptyState = ({ title, message, actionLabel, onAction }) => (
  <div className='flex flex-col items-center justify-center py-16 text-center text-gray-500'>
    <p className='text-lg font-medium text-gray-700'>{title}</p>
    {message && <p className='text-sm mt-2 max-w-md'>{message}</p>}
    {actionLabel && onAction && (
      <button onClick={onAction} className='mt-4 px-6 py-2 bg-primary text-white rounded-full text-sm'>
        {actionLabel}
      </button>
    )}
  </div>
)

export default EmptyState
