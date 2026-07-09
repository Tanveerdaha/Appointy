import api, { apiBaseUrl } from '../api/client.js'
import { createContext, useEffect, useState } from 'react'
import { toast } from 'react-toastify'

export const AdminContext = createContext()

const AdminContextProvider = (props) => {
    const [aToken, setAToken] = useState(localStorage.getItem('aToken') || '')
    const backendUrl = apiBaseUrl
    const [appointments, setAppointments] = useState(null)
    const [doctors, setDoctors] = useState([])
    const [patients, setPatients] = useState(null)
    const [dashData, setDashData] = useState(null)

    useEffect(() => {
        const onLogout = () => setAToken('')
        window.addEventListener('auth:logout', onLogout)
        return () => window.removeEventListener('auth:logout', onLogout)
    }, [])

    const getAllDoctors = async () => {
        try {
            const { data } = await api.get('/api/admin/all-doctors')
            if (data.success) setDoctors(data.doctors)
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setDoctors([])
        }
    }

    const getPatients = async () => {
        try {
            const { data } = await api.get('/api/admin/users')
            if (data.success) setPatients(data.users)
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setPatients([])
        }
    }

    const changeAvailability = async (docId) => {
        try {
            const { data } = await api.post('/api/admin/change-availability', { docId })
            if (data.success) {
                toast.success(data.message)
                getAllDoctors()
            } else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }

    const getAllAppointments = async () => {
        try {
            const { data } = await api.get('/api/admin/appointments')
            if (data.success) setAppointments(data.appointments.reverse())
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setAppointments([])
        }
    }

    const cancelAppointment = async (appointmentId) => {
        if (!window.confirm('Cancel this appointment?')) return
        try {
            const { data } = await api.post('/api/admin/cancel-appointment', { appointmentId })
            if (data.success) {
                toast.success(data.message)
                getAllAppointments()
                getDashData()
            } else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }

    const completeAppointment = async (appointmentId) => {
        if (!window.confirm('Mark this appointment as complete?')) return
        try {
            const { data } = await api.post('/api/admin/complete-appointment', { appointmentId })
            if (data.success) {
                toast.success(data.message)
                getAllAppointments()
                getDashData()
            } else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }

    const updateDoctor = async (formData) => {
        try {
            const { data } = await api.post('/api/admin/update-doctor', formData)
            if (data.success) {
                toast.success(data.message)
                getAllDoctors()
            } else toast.error(data.message)
            return data.success
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            return false
        }
    }

    const deleteDoctor = async (docId) => {
        try {
            const { data } = await api.post('/api/admin/delete-doctor', { docId })
            if (data.success) {
                toast.success(data.message)
                getAllDoctors()
            } else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }

    const getDashData = async () => {
        try {
            const { data } = await api.get('/api/admin/dashboard')
            if (data.success) setDashData(data.dashData)
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setDashData({ doctors: 0, appointments: 0, patients: 0, revenue: 0, paidAppointments: 0, latestAppointments: [] })
        }
    }

    const value = {
        aToken, setAToken,
        backendUrl, doctors,
        getAllDoctors, changeAvailability,
        appointments, getAllAppointments, cancelAppointment, completeAppointment,
        updateDoctor, deleteDoctor,
        getDashData, dashData,
        patients, getPatients,
    }

    return (
        <AdminContext.Provider value={value}>
            {props.children}
        </AdminContext.Provider>
    )
}

export default AdminContextProvider
