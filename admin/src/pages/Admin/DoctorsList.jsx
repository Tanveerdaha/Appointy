import React, { useContext, useEffect, useState } from 'react'
import { AdminContext } from '../../context/adminContext'
import { AppContext } from '../../context/appContext'
import { SPECIALITIES } from '../../constants/specialities'

const DoctorsList = () => {

  const { doctors, aToken, getAllDoctors, changeAvailability, updateDoctor, deleteDoctor } = useContext(AdminContext)
  const { getId } = useContext(AppContext)
  const [editDoctor, setEditDoctor] = useState(null)
  const [form, setForm] = useState({})

  useEffect(() => {
    if (aToken) {
        getAllDoctors()
    }
}, [aToken, getAllDoctors])

  const openEdit = (doctor) => {
    setEditDoctor(doctor)
    setForm({
      name: doctor.name,
      email: doctor.email,
      speciality: doctor.speciality,
      degree: doctor.degree,
      experience: doctor.experience,
      fees: doctor.fees,
      about: doctor.about,
      address1: doctor.address?.line1 || '',
      address2: doctor.address?.line2 || '',
    })
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    const formData = new FormData()
    formData.append('docId', getId(editDoctor))
    formData.append('name', form.name)
    formData.append('email', form.email)
    formData.append('speciality', form.speciality)
    formData.append('degree', form.degree)
    formData.append('experience', form.experience)
    formData.append('fees', Number(form.fees))
    formData.append('about', form.about)
    formData.append('address', JSON.stringify({ line1: form.address1, line2: form.address2 }))
    const imageInput = document.getElementById('edit-doc-img')
    if (imageInput?.files?.[0]) {
      formData.append('image', imageInput.files[0])
    }
    const success = await updateDoctor(formData)
    if (success) setEditDoctor(null)
  }

  const handleDelete = async (doctor) => {
    if (!window.confirm(`Remove Dr. ${doctor.name}? They will be hidden from listings. Appointment history is preserved.`)) return
    await deleteDoctor(getId(doctor))
  }

  return (
    <div className='m-5 max-h-[90vh] overflow-y-scroll'>
      <h1 className='text-lg font-medium'>All Doctors</h1>
      <div className='w-full flex flex-wrap gap-4 pt-5 gap-y-6'>
        {doctors.map((item, index) => (
          <div className='border border-[#C9D8FF] rounded-xl max-w-56 overflow-hidden group' key={getId(item) || index}>
            <img className='bg-[#EAEFFF] group-hover:bg-primary transition-all duration-500' src={item.image} alt="" />
            <div className='p-4'>
              <p className='text-[#262626] text-lg font-medium'>{item.name}</p>
              <p className='text-[#5C5C5C] text-sm'>{item.speciality}</p>
              <div className='mt-2 flex items-center gap-1 text-sm'>
                <input onChange={()=>changeAvailability(getId(item))} type="checkbox" checked={item.available} />
                <p>Available</p>
              </div>
              <div className='flex gap-2 mt-3'>
                <button onClick={() => openEdit(item)} className='text-xs px-3 py-1 border rounded hover:bg-primary hover:text-white'>Edit</button>
                <button onClick={() => handleDelete(item)} className='text-xs px-3 py-1 border border-red-400 text-red-500 rounded hover:bg-red-500 hover:text-white'>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editDoctor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleUpdate} className="bg-white p-6 rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <p className="text-lg font-medium mb-4">Edit Doctor</p>
            <div className="flex flex-col gap-3 text-sm">
              <input className="border rounded px-3 py-2" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <input className="border rounded px-3 py-2" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              <select className="border rounded px-3 py-2" value={form.speciality} onChange={(e) => setForm({ ...form, speciality: e.target.value })}>
                {SPECIALITIES.map((spec) => (
                  <option key={spec} value={spec}>{spec}</option>
                ))}
              </select>
              <input className="border rounded px-3 py-2" placeholder="Degree" value={form.degree} onChange={(e) => setForm({ ...form, degree: e.target.value })} required />
              <input className="border rounded px-3 py-2" placeholder="Experience" value={form.experience} onChange={(e) => setForm({ ...form, experience: e.target.value })} required />
              <input className="border rounded px-3 py-2" placeholder="Fees" type="number" value={form.fees} onChange={(e) => setForm({ ...form, fees: e.target.value })} required />
              <input className="border rounded px-3 py-2" placeholder="Address line 1" value={form.address1} onChange={(e) => setForm({ ...form, address1: e.target.value })} required />
              <input className="border rounded px-3 py-2" placeholder="Address line 2" value={form.address2} onChange={(e) => setForm({ ...form, address2: e.target.value })} required />
              <textarea className="border rounded px-3 py-2" placeholder="About" rows={3} value={form.about} onChange={(e) => setForm({ ...form, about: e.target.value })} required />
              <input type="file" id="edit-doc-img" accept="image/*" className="text-sm" />
            </div>
            <div className="flex gap-3 mt-4">
              <button type="button" onClick={() => setEditDoctor(null)} className="flex-1 py-2 border rounded">Cancel</button>
              <button type="submit" className="flex-1 py-2 bg-primary text-white rounded">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export default DoctorsList
