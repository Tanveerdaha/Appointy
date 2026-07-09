import api, { apiBaseUrl } from '../api/client'
import React, { useContext, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { DoctorContext } from '../context/doctorContext'
import { AdminContext } from '../context/adminContext'
import { toast } from 'react-toastify'

const Login = () => {
  const [state, setState] = useState('Admin')
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('admin123')
  const [loading, setLoading] = useState(false)

  const navigate = useNavigate()
  const backendUrl = apiBaseUrl || `${window.location.origin}/api (proxy)`

  const { setDToken } = useContext(DoctorContext)
  const { setAToken } = useContext(AdminContext)

  const onSubmitHandler = async (event) => {
    event.preventDefault()
    setLoading(true)

    try {
      if (state === 'Admin') {
        const { data } = await api.post('/api/admin/login', { email, password })
        if (data.success) {
          localStorage.removeItem('dToken')
          localStorage.setItem('aToken', data.token)
          flushSync(() => {
            setDToken('')
            setAToken(data.token)
          })
          toast.success('Admin login successful')
          navigate('/admin-dashboard', { replace: true })
        } else {
          toast.error(data.message || 'Invalid credentials')
        }
      } else {
        const { data } = await api.post('/api/doctor/login', { email, password })
        if (data.success) {
          localStorage.removeItem('aToken')
          localStorage.setItem('dToken', data.token)
          flushSync(() => {
            setAToken('')
            setDToken(data.token)
          })
          toast.success('Doctor login successful')
          navigate('/doctor-dashboard', { replace: true })
        } else {
          toast.error(data.message || 'Invalid credentials')
        }
      }
    } catch (error) {
      if (error.code === 'ERR_NETWORK' || !error.response) {
        toast.error('Cannot reach API. Start backend: cd backend && npm run server')
      } else {
        toast.error(error.response?.data?.message || error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmitHandler} className='min-h-screen flex items-center justify-center p-4 bg-[#F8F9FD]'>
      <div className='flex flex-col gap-3 w-full max-w-md items-start p-8 border rounded-xl text-[#5E5E5E] text-sm shadow-lg bg-white'>
        <p className='text-2xl font-semibold m-auto'><span className='text-primary'>{state}</span> Login</p>
        <p className='text-xs text-gray-400 text-center w-full'>API: {backendUrl}</p>
        <div className='w-full'>
          <p>Email</p>
          <input onChange={(e) => setEmail(e.target.value)} value={email} className='border border-[#DADADA] rounded w-full p-2 mt-1' type="email" required />
        </div>
        <div className='w-full'>
          <p>Password</p>
          <input onChange={(e) => setPassword(e.target.value)} value={password} className='border border-[#DADADA] rounded w-full p-2 mt-1' type="password" required />
        </div>
        <button type='submit' disabled={loading} className='bg-primary text-white w-full py-2 rounded-md text-base disabled:opacity-60 cursor-pointer'>
          {loading ? 'Logging in...' : 'Login'}
        </button>
        {state === 'Admin'
          ? <p>Doctor Login? <button type='button' onClick={() => setState('Doctor')} className='text-primary underline cursor-pointer bg-transparent border-0 p-0'>Click here</button></p>
          : <p>Admin Login? <button type='button' onClick={() => setState('Admin')} className='text-primary underline cursor-pointer bg-transparent border-0 p-0'>Click here</button></p>
        }
      </div>
    </form>
  )
}

export default Login
