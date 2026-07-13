import { AppContext } from './appContext'

const currencyCode = (import.meta.env.VITE_CURRENCY || 'PKR').toUpperCase()
const currency = ['PKR', 'INR'].includes(currencyCode) ? 'Rs.' : currencyCode

const AppContextProvider = (props) => {
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
    calculateAge,
    slotDateFormat,
    currency,
    getId,
  }

  return (
    <AppContext.Provider value={value}>
      {props.children}
    </AppContext.Provider>
  )
}

export default AppContextProvider
