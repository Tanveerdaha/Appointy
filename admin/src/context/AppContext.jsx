import { AppContext } from './appContext'

const AppContextProvider = (props) => {
  const currency = import.meta.env.VITE_CURRENCY === 'INR' ? 'Rs.' : (import.meta.env.VITE_CURRENCY || 'Rs.')
  const backendUrl = import.meta.env.VITE_BACKEND_URL
  const months = [' ', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const getId = (item) => item?.id ?? item?._id

  const slotDateFormat = (slotDate) => {
    const dateArray = slotDate.split('_')
    return dateArray[0] + ' ' + months[Number(dateArray[1])] + ' ' + dateArray[2]
  }

  const calculateAge = (dob) => {
    if (!dob || dob === 'Not Selected') return 'N/A'
    const today = new Date()
    const birthDate = new Date(dob)
    if (isNaN(birthDate.getTime())) return 'N/A'
    return today.getFullYear() - birthDate.getFullYear()
  }

  const value = {
    calculateAge, slotDateFormat, currency, getId, backendUrl,
  }

  return (
    <AppContext.Provider value={value}>
      {props.children}
    </AppContext.Provider>
  )
}

export default AppContextProvider
