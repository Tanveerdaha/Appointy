import api from '../api/client.js'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { AdminContext } from './adminContext'

const AdminContextProvider = (props) => {
    const [aToken, setAToken] = useState(localStorage.getItem('aToken') || '')
    const [appointments, setAppointments] = useState(null)
    const [doctors, setDoctors] = useState([])
    const [patients, setPatients] = useState(null)
    const [dashData, setDashData] = useState(null)

    useEffect(() => {
        const onLogout = () => setAToken('')
        window.addEventListener('auth:logout', onLogout)
        return () => window.removeEventListener('auth:logout', onLogout)
    }, [])

    const getAllDoctors = useCallback(async () => {
        try {
            const { data } = await api.get('/api/admin/all-doctors')
            if (data.success) setDoctors(data.doctors)
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setDoctors([])
        }
    }, [])

    const getPatients = useCallback(async () => {
        try {
            const { data } = await api.get('/api/admin/users')
            if (data.success) setPatients(data.users)
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setPatients([])
        }
    }, [])

    const getDashData = useCallback(async () => {
        try {
            const { data } = await api.get('/api/admin/dashboard')
            if (data.success) setDashData(data.dashData)
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setDashData({ doctors: 0, appointments: 0, patients: 0, revenue: 0, paidAppointments: 0, latestAppointments: [] })
        }
    }, [])

    const getAllAppointments = useCallback(async () => {
        try {
            const { data } = await api.get('/api/admin/appointments')
            if (data.success) setAppointments(data.appointments.reverse())
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setAppointments([])
        }
    }, [])

    const changeAvailability = useCallback(async (docId) => {
        try {
            const { data } = await api.post('/api/admin/change-availability', { docId })
            if (data.success) {
                toast.success(data.message)
                getAllDoctors()
            } else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }, [getAllDoctors])

    const cancelAppointment = useCallback(async (appointmentId, { paymentStatus } = {}) => {
        const isPaid = paymentStatus === 'paid' || paymentStatus === 'refund_failed'
        let reason = 'Cancelled by admin'
        if (isPaid) {
            reason = window.prompt(
                'Paid appointment — enter refund reason (required):',
                'Admin cancellation'
            )
            if (reason == null) return
            reason = reason.trim()
            if (!reason) {
                toast.error('Refund reason is required for paid appointments')
                return
            }
        } else if (!window.confirm('Cancel this appointment?')) {
            return
        }

        try {
            const { data } = await api.post('/api/admin/cancel-appointment', {
                appointmentId,
                reason,
            })
            if (data.success) {
                toast.success(data.message)
                getAllAppointments()
                getDashData()
            } else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }, [getAllAppointments, getDashData])

    const completeAppointment = useCallback(async (appointmentId) => {
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
    }, [getAllAppointments, getDashData])

    const updateDoctor = useCallback(async (formData) => {
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
    }, [getAllDoctors])

    const deleteDoctor = useCallback(async (docId) => {
        try {
            const { data } = await api.post('/api/admin/delete-doctor', { docId })
            if (data.success) {
                toast.success(data.message)
                getAllDoctors()
            } else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }, [getAllDoctors])

    const value = {
        aToken, setAToken,
        doctors,
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
