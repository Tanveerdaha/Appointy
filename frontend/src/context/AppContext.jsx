import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import api, { apiBaseUrl } from '../api/client'
import { AppContext } from './appContext'

const normalizeDoctor = (doc) => ({
    ...doc,
    id: doc.id ?? doc._id,
    _id: doc._id ?? doc.id,
    slots_booked: doc.slots_booked ?? {},
    available: doc.available ?? true,
    address: doc.address ?? { line1: '', line2: '' },
})

const AppContextProvider = (props) => {
    const currencySymbol = 'Rs.'
    const backendUrl = apiBaseUrl

    const [doctors, setDoctors] = useState([])
    const [doctorsLoaded, setDoctorsLoaded] = useState(false)
    const [token, setToken] = useState(localStorage.getItem('token') || '')
    const [userData, setUserData] = useState(false)

    const getDoctorsData = useCallback(async () => {
        try {
            const { data } = await api.get('/api/doctor/list')
            if (data.success) {
                setDoctors((data.doctors || []).map(normalizeDoctor))
            } else {
                setDoctors([])
                toast.error(data.message)
            }
        } catch (error) {
            console.log(error)
            setDoctors([])
            toast.error(error.response?.data?.message || error.message || 'Failed to load doctors')
        } finally {
            setDoctorsLoaded(true)
        }
    }, [])

    const loadUserProfileData = useCallback(async () => {
        try {
            const { data } = await api.get('/api/user/get-profile')

            if (data.success) {
                const safeUserData = {
                    ...data.userData,
                    address: data.userData.address || { line1: '', line2: '' },
                    gender: data.userData.gender === 'Not Selected' ? '' : (data.userData.gender || ''),
                    dob: data.userData.dob === 'Not Selected' ? '' : (data.userData.dob || ''),
                    image: data.userData.image || '',
                }
                setUserData(safeUserData)
            } else {
                toast.error(data.message)
            }
        } catch (error) {
            console.log(error)
            toast.error(error.message)
        }
    }, [])

    const logout = useCallback(() => {
        localStorage.removeItem('token')
        setToken('')
        setUserData(false)
    }, [])

    useEffect(() => {
        getDoctorsData()
    }, [getDoctorsData])

    useEffect(() => {
        if (token) {
            loadUserProfileData()
        } else {
            setUserData(false)
        }
    }, [token, loadUserProfileData])

    const value = {
        doctors,
        doctorsLoaded,
        getDoctorsData,
        currencySymbol,
        backendUrl,
        token,
        setToken,
        userData,
        setUserData,
        loadUserProfileData,
        logout,
    }

    return (
        <AppContext.Provider value={value}>
            {props.children}
        </AppContext.Provider>
    )
}

export default AppContextProvider
