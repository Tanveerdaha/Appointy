import { createContext } from "react";

export const AppContext = createContext()

const AppContextProvider = (props) => {

    const currency = import.meta.env.VITE_CURRENCY === 'INR' ? 'Rs.' : (import.meta.env.VITE_CURRENCY || 'Rs.')
    const backendUrl = import.meta.env.VITE_BACKEND_URL
const months = [" ","Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    const getId = (item) => item?.id ?? item?._id

    // Function to format the date eg. ( 20_01_2000 => 20 Jan 2000 )
    const slotDateFormat = (slotDate) => {
        const dateArray = slotDate.split('_')
        return dateArray[0] + " " + months[Number(dateArray[1])] + " " + dateArray[2]
    }


// Function to calculate the age eg. ( 20_01_2000 => 24 )
    const calculateAge = (dob) => {
        if (!dob || dob === 'Not Selected') return 'N/A'
        const today = new Date()
        const birthDate = new Date(dob)
        if (isNaN(birthDate.getTime())) return 'N/A'
        let age = today.getFullYear() - birthDate.getFullYear()
        return age
    }

  const value={
    calculateAge, slotDateFormat, currency, getId, backendUrl

  }
  return (
<AppContext.Provider value= {value}>
    {props.children}
</AppContext.Provider>

  )

}
export default AppContextProvider