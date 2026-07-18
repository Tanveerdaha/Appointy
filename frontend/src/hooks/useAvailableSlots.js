import { useEffect, useState } from 'react'

const daysOfWeek = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** ISO-8601 with numeric offset from the Date's local timezone. */
export const toOffsetISOString = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  const tzo = -date.getTimezoneOffset()
  const sign = tzo >= 0 ? '+' : '-'
  const abs = Math.abs(tzo)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

export const useAvailableSlots = (docInfo) => {
  const [docSlots, setDocSlots] = useState([])

  useEffect(() => {
    if (!docInfo) {
      setDocSlots([])
      return
    }

    const today = new Date()
    const slots_booked = docInfo.slots_booked || {}
    const allSlots = []

    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(today)
      currentDate.setDate(today.getDate() + i)

      const endTime = new Date(currentDate)
      endTime.setHours(21, 0, 0, 0)

      if (today.getDate() === currentDate.getDate()) {
        currentDate.setHours(currentDate.getHours() > 10 ? currentDate.getHours() + 1 : 10)
        currentDate.setMinutes(currentDate.getMinutes() > 30 ? 30 : 0)
      } else {
        currentDate.setHours(10)
        currentDate.setMinutes(0)
      }

      const timeSlots = []

      while (currentDate < endTime) {
        const formattedTime = currentDate.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })

        const day = currentDate.getDate()
        const month = currentDate.getMonth() + 1
        const year = currentDate.getFullYear()
        const slotDate = `${day}_${month}_${year}`

        const isSlotAvailable =
          !slots_booked[slotDate] || !slots_booked[slotDate].includes(formattedTime)

        if (isSlotAvailable) {
          const datetime = new Date(currentDate)
          timeSlots.push({
            datetime,
            time: formattedTime,
            slotDate,
            startTime: toOffsetISOString(datetime),
          })
        }

        currentDate.setMinutes(currentDate.getMinutes() + 30)
      }

      allSlots.push(timeSlots)
    }

    setDocSlots(allSlots)
  }, [docInfo])

  return { docSlots, daysOfWeek }
}

export default useAvailableSlots
