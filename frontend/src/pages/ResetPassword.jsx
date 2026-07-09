import React, { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { toast } from 'react-toastify'

const ResetPassword = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const email = searchParams.get('email') || ''
  const token = searchParams.get('token') || ''
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await axios.post(`${backendUrl}/api/user/reset-password`, { email, token, password })
      if (data.success) {
        toast.success(data.message)
        navigate('/login')
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    } finally {
      setLoading(false)
    }
  }

  if (!email || !token) {
    return (
      <div className='min-h-[60vh] flex items-center justify-center'>
        <p className='text-gray-600'>Invalid reset link. <Link to='/forgot-password' className='text-primary underline'>Request a new one</Link></p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className='min-h-[60vh] flex items-center justify-center'>
      <div className='border rounded-xl p-8 w-full max-w-md shadow-lg'>
        <h1 className='text-2xl font-semibold text-center mb-6'>Reset Password</h1>
        <input
          type='password'
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className='border rounded w-full p-2 mb-4'
          placeholder='New password (min 8 chars)'
          minLength={8}
          required
        />
        <button disabled={loading} className='bg-primary text-white w-full py-2 rounded-full'>
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>
      </div>
    </form>
  )
}

export default ResetPassword
