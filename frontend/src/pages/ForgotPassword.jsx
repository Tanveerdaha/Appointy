import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { toast } from 'react-toastify'

const ForgotPassword = () => {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await axios.post(`${backendUrl}/api/user/forgot-password`, { email })
      toast.success(data.message)
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className='min-h-[60vh] flex items-center justify-center'>
      <div className='border rounded-xl p-8 w-full max-w-md shadow-lg'>
        <h1 className='text-2xl font-semibold text-center mb-2'>Forgot Password</h1>
        <p className='text-sm text-gray-500 text-center mb-6'>Enter your email to receive a reset link.</p>
        <input
          type='email'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className='border rounded w-full p-2 mb-4'
          placeholder='Email'
          required
        />
        <button disabled={loading} className='bg-primary text-white w-full py-2 rounded-full'>
          {loading ? 'Sending...' : 'Send Reset Link'}
        </button>
        <p className='text-sm text-center mt-4'>
          <Link to='/login' className='text-primary underline'>Back to Login</Link>
        </p>
      </div>
    </form>
  )
}

export default ForgotPassword
