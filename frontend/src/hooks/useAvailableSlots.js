import { useContext, useEffect, useState } from 'react'
import { AppContext } from '../context/appContext'
import { buildAvailableSlots, DEFAULT_SCHEDULING_CONFIG } from '../utils/clinicTime'

const daysOfWeek = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export const useAvailableSlots = (docInfo) => {
  const { schedulingConfig } = useContext(AppContext)
  const [docSlots, setDocSlots] = useState([])

  useEffect(() => {
    if (!docInfo) {
      setDocSlots([])
      return
    }

    const config = schedulingConfig || DEFAULT_SCHEDULING_CONFIG
    setDocSlots(buildAvailableSlots(docInfo, config))
  }, [docInfo, schedulingConfig])

  return { docSlots, daysOfWeek, schedulingConfig: schedulingConfig || DEFAULT_SCHEDULING_CONFIG }
}

export default useAvailableSlots
