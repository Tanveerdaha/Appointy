import React from 'react'
import { useNavigate } from 'react-router-dom'

const DoctorCard = ({ doctor, onClick }) => {
  const navigate = useNavigate()
  const docId = doctor.id || doctor._id
  const available = doctor.available ?? true

  const handleClick = () => {
    if (!available) return
    if (onClick) {
      onClick(doctor)
    } else {
      navigate(`/appointment/${docId}`)
      scrollTo(0, 0)
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`border border-[#C9D8FF] rounded-xl overflow-hidden transition-all duration-500 ${
        available ? 'cursor-pointer hover:translate-y-[-10px]' : 'opacity-60 cursor-not-allowed'
      }`}
    >
      <img className='bg-[#EAEFFF] w-full' src={doctor.image} alt={doctor.name} />
      <div className='p-4'>
        <div className={`flex items-center gap-2 text-sm ${available ? 'text-green-500' : 'text-gray-500'}`}>
          <p className={`w-2 h-2 rounded-full ${available ? 'bg-green-500' : 'bg-gray-500'}`} />
          <p>{available ? 'Available' : 'Not Available'}</p>
        </div>
        <p className='text-[#262626] text-lg font-medium'>{doctor.name}</p>
        <p className='text-[#5C5C5C] text-sm'>{doctor.speciality}</p>
      </div>
    </div>
  )
}

export default DoctorCard
