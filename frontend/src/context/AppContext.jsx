import { createContext, useEffect, useState } from "react";
import { toast } from "react-toastify";
import axios from 'axios'
import { doctors as localDoctors } from "../assets/assets";

axios.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token')
            window.location.href = '/login'
        }
        return Promise.reject(error)
    }
)

axios.interceptors.request.use((config) => {
    const token = localStorage.getItem('token')
    if (token) {
        config.headers.token = token
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
})

export const AppContext = createContext()

const DEFAULT_BACKEND_URL = 'http://localhost:4000'

const AppContextProvider = (props) => {
    const currencySymbol = '₹'
    const backendUrl = import.meta.env.VITE_BACKEND_URL || DEFAULT_BACKEND_URL

    const [doctors, setDoctors] = useState([])
    const [token, setToken] = useState(localStorage.getItem('token') || '')
    const [userData, setUserData] = useState(false)

    const normalizeDoctor = (doc) => ({
        ...doc,
        id: doc.id ?? doc._id,
        _id: doc._id ?? doc.id,
        slots_booked: doc.slots_booked ?? {},
        available: doc.available ?? true,
        address: doc.address ?? { line1: '', line2: '' },
    })

    const getDoctorsData = async () => {
        // If backend isn't configured, use local seeded doctor assets
        if (!backendUrl) {
            setDoctors(localDoctors.map(normalizeDoctor))
            return
        }
        try {
            const { data } = await axios.get(backendUrl + '/api/doctor/list')
            if (data.success) {
                setDoctors((data.doctors || []).map(normalizeDoctor))
            } else {
                toast.error(data.message)
            }
        } catch (error) {
            console.log(error)
            // Fall back to local data so UI still works offline
            setDoctors(localDoctors.map(normalizeDoctor))
            toast.error(error.message || 'Failed to load doctors from API, showing local data')
        }
    }

    const loadUserProfileData = async () => {
        try {
            const { data } = await axios.get(backendUrl + '/api/user/get-profile', {
                headers: { token }
            })

            if (data.success) {
                const safeUserData = {
                    ...data.userData,
                    address: data.userData.address || { line1: '', line2: '' },
                    gender: data.userData.gender === 'Not Selected' ? '' : (data.userData.gender || ''),
                    dob: data.userData.dob === 'Not Selected' ? '' : (data.userData.dob || ''),
                    image: data.userData.image || ''
                }
                setUserData(safeUserData)
            } else {
                toast.error(data.message)
            }
        } catch (error) {
            console.log(error)
            toast.error(error.message)
        }
    }

    useEffect(() => {
        getDoctorsData()
    }, [])

    useEffect(() => {
        if (token) {
            loadUserProfileData()
        }
    }, [token])

    const value = {
        doctors, getDoctorsData,
        currencySymbol,
        backendUrl,
        token, setToken,
        userData, setUserData, loadUserProfileData
    }

    return (
        <AppContext.Provider value={value}>
            {props.children}
        </AppContext.Provider>
    )
}

export default AppContextProvider
