import React, { useState } from 'react'
import useAvailableSlots from '../hooks/useAvailableSlots'

const RescheduleModal = ({ appointment, doctors, onClose, onConfirm }) => {
  const [slotIndex, setSlotIndex] = useState(0)
  const [slotTime, setSlotTime] = useState('')

  const docInfo = doctors.find((doc) => (doc.id || doc._id) === appointment.docId)
  const { docSlots, daysOfWeek } = useAvailableSlots(docInfo)

  const handleConfirm = () => {
    const selectedDay = docSlots[slotIndex]
    if (!slotTime || !selectedDay?.length) return

    const selectedSlot = selectedDay.find((s) => s.time === slotTime)
    if (!selectedSlot) return

    onConfirm({
      appointmentId: appointment.id || appointment._id,
      newSlotDate: selectedSlot.slotDate,
      newSlotTime: slotTime,
    })
  }

  if (!docInfo) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded-lg max-w-md">
          <p className="text-gray-600">Doctor information not available for rescheduling.</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 border rounded">Close</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <p className="text-lg font-medium mb-4">Reschedule with {docInfo.name}</p>

        <div className="flex gap-3 overflow-x-auto mt-2">
          {docSlots.map((item, index) => (
            <div
              onClick={() => { setSlotIndex(index); setSlotTime('') }}
              key={index}
              className={`text-center py-4 min-w-16 rounded-full cursor-pointer ${slotIndex === index ? 'bg-primary text-white' : 'border border-[#DDDDDD]'}`}
            >
              <p className="text-xs">{item[0] && daysOfWeek[item[0].datetime.getDay()]}</p>
              <p>{item[0] && item[0].datetime.getDate()}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap mt-4">
          {docSlots[slotIndex]?.map((item, index) => (
            <p
              onClick={() => setSlotTime(item.time)}
              key={index}
              className={`text-sm px-4 py-2 rounded-full cursor-pointer ${item.time === slotTime ? 'bg-primary text-white' : 'border border-gray-300 text-gray-600'}`}
            >
              {item.time.toLowerCase()}
            </p>
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border rounded">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!slotTime}
            className={`flex-1 py-2 rounded text-white ${slotTime ? 'bg-primary' : 'bg-gray-400 cursor-not-allowed'}`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

export default RescheduleModal
