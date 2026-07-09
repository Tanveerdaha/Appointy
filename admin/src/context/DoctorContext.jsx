import api, { apiBaseUrl } from '../api/client.js'
import { createContext, useEffect, useState } from 'react'
import { toast } from 'react-toastify'

export const DoctorContext = createContext()

const DoctorContextProvider = (props) => {
  const backendUrl = apiBaseUrl

  const [dToken, setDToken] = useState(
    localStorage.getItem('dToken') || ''
  )
  const [appointments, setAppointments] = useState([])
  const [dashData, setDashData] = useState(false)
  const [profileData, setProfileData] = useState(false)

  useEffect(() => {
    const onLogout = () => setDToken('')
    window.addEventListener('auth:logout', onLogout)
    return () => window.removeEventListener('auth:logout', onLogout)
  }, [])

  const getAppointments = async () => {
    try {
      const { data } = await api.get('/api/doctor/appointments')

      if (data.success) {
        setAppointments(data.appointments.reverse())
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error(error)
      toast.error(error.response?.data?.message || error.message)
    }
  }

  const completeAppointment = async (appointmentId) => {
    try {
      const { data } = await api.post('/api/doctor/complete-appointment', { appointmentId })

      if (data.success) {
        toast.success(data.message)
        getAppointments()
        getDashData()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error(error)
      toast.error(error.response?.data?.message || error.message)
    }
  }

  const cancelAppointment = async (appointmentId) => {
    try {
      const { data } = await api.post('/api/doctor/cancel-appointment', { appointmentId })

      if (data.success) {
        toast.success(data.message)
        getAppointments()
        getDashData()
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error(error)
      toast.error(error.response?.data?.message || error.message)
    }
  }

  const getDashData = async () => {
    try {
      const { data } = await api.get('/api/doctor/dashboard')

      if (data.success) {
        setDashData(data.dashData)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error(error)
      toast.error(error.response?.data?.message || error.message)
    }
  }

  const getProfileData = async () => {
    try {
      const { data } = await api.get('/api/doctor/profile')

      if (data.success) {
        setProfileData(data.profileData)
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      console.error(error)
      toast.error(error.response?.data?.message || error.message)
    }
  }

  const value = {
    dToken,
    setDToken,
    backendUrl,
    getAppointments,
    appointments,
    setAppointments,
    completeAppointment,
    cancelAppointment,
    getDashData,
    dashData,
    setDashData,
    getProfileData,
    setProfileData,
    profileData,
  }

  return (
    <DoctorContext.Provider value={value}>
      {props.children}
    </DoctorContext.Provider>
  )
}

export default DoctorContextProvider
