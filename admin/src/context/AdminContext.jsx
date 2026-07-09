import axios from "axios";
import { createContext, useState } from "react";
import { toast } from "react-toastify";

axios.interceptors.response.use(
    (response) => response,
    (error) => {
        const isLoginRequest = error.config?.url?.includes('/login')
        if (error.response?.status === 401 && !isLoginRequest) {
            localStorage.removeItem('aToken')
            localStorage.removeItem('dToken')
            window.location.href = '/'
        }
        return Promise.reject(error)
    }
)

export const AdminContext = createContext()

const authHeaders = (aToken) => ({
    aToken,
    Authorization: `Bearer ${aToken}`,
})

const AdminContextProvider = (props) => {
    const [aToken, setAToken] = useState(localStorage.getItem('aToken') || '')
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'
    const [appointments, setAppointments] = useState(null)
    const [doctors, setDoctors] = useState([])
    const [patients, setPatients] = useState(null)
    const [dashData, setDashData] = useState(null)

    const getAllDoctors = async () => {
        try {
            const { data } = await axios.get(`${backendUrl}/api/admin/all-doctors`, { headers: authHeaders(aToken) })
            if (data.success) setDoctors(data.doctors)
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }

    const getPatients = async () => {
        try {
            const { data } = await axios.get(`${backendUrl}/api/admin/users`, { headers: authHeaders(aToken) })
            if (data.success) setPatients(data.users)
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
            setPatients([])
        }
    }

    const changeAvailability = async (docId) => {
        try {
            const { data } = await axios.post(`${backendUrl}/api/admin/change-availability`, { docId }, { headers: authHeaders(aToken) })
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
            const { data } = await axios.get(`${backendUrl}/api/admin/appointments`, { headers: authHeaders(aToken) })
            if (data.success) setAppointments(data.appointments.reverse())
            else toast.error(data.message)
        } catch (error) {
            toast.error(error.response?.data?.message || error.message)
        }
    }

    const cancelAppointment = async (appointmentId) => {
        if (!window.confirm('Cancel this appointment?')) return
        try {
            const { data } = await axios.post(`${backendUrl}/api/admin/cancel-appointment`, { appointmentId }, { headers: authHeaders(aToken) })
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
            const { data } = await axios.post(`${backendUrl}/api/admin/complete-appointment`, { appointmentId }, { headers: authHeaders(aToken) })
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
            const { data } = await axios.post(`${backendUrl}/api/admin/update-doctor`, formData, { headers: authHeaders(aToken) })
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
            const { data } = await axios.post(`${backendUrl}/api/admin/delete-doctor`, { docId }, { headers: authHeaders(aToken) })
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
            const { data } = await axios.get(`${backendUrl}/api/admin/dashboard`, { headers: authHeaders(aToken) })
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
