import axios from 'axios'
import React, { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DoctorContext } from '../context/DoctorContext'
import { AdminContext } from '../context/AdminContext'
import { toast } from 'react-toastify'

const Login = () => {
  const [state, setState] = useState('Admin')
  const [email, setEmail] = useState('admin@example.com')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const navigate = useNavigate()
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'

  const { setDToken } = useContext(DoctorContext)
  const { setAToken } = useContext(AdminContext)

  const onSubmitHandler = async (event) => {
    event.preventDefault()
    setLoading(true)

    try {
      if (state === 'Admin') {
        const { data } = await axios.post(`${backendUrl}/api/admin/login`, { email, password })
        if (data.success) {
          localStorage.removeItem('dToken')
          setDToken('')
          setAToken(data.token)
          localStorage.setItem('aToken', data.token)
          toast.success('Admin login successful')
          navigate('/admin-dashboard')
        } else {
          toast.error(data.message || 'Invalid credentials')
        }
      } else {
        const { data } = await axios.post(`${backendUrl}/api/doctor/login`, { email, password })
        if (data.success) {
          localStorage.removeItem('aToken')
          setAToken('')
          setDToken(data.token)
          localStorage.setItem('dToken', data.token)
          toast.success('Doctor login successful')
          navigate('/doctor-dashboard')
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
    <form onSubmit={onSubmitHandler} className='min-h-[80vh] flex items-center'>
      <div className='flex flex-col gap-3 m-auto items-start p-8 min-w-[340px] sm:min-w-96 border rounded-xl text-[#5E5E5E] text-sm shadow-lg'>
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
        <button type='submit' disabled={loading} className='bg-primary text-white w-full py-2 rounded-md text-base disabled:opacity-60'>
          {loading ? 'Logging in...' : 'Login'}
        </button>
        {state === 'Admin'
          ? <p>Doctor Login? <span onClick={() => setState('Doctor')} className='text-primary underline cursor-pointer'>Click here</span></p>
          : <p>Admin Login? <span onClick={() => setState('Admin')} className='text-primary underline cursor-pointer'>Click here</span></p>
        }
      </div>
    </form>
  )
}

export default Login
