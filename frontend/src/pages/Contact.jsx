import React, { useState } from 'react'
import { assets } from '../assets/assets'
import axios from 'axios'
import { toast } from 'react-toastify'

const Contact = () => {
  const [form, setForm] = useState({ name: '', email: '', message: '' })
  const [loading, setLoading] = useState(false)
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await axios.post(`${backendUrl}/api/user/contact`, form)
      if (data.success) {
        toast.success(data.message)
        setForm({ name: '', email: '', message: '' })
      } else {
        toast.error(data.message)
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className='text-center text-2xl pt-10 text-[#707070]'>
        <p>CONTACT <span className='text-gray-700 font-semibold'>US</span></p>
      </div>

      <div className='my-10 flex flex-col justify-center md:flex-row gap-10 mb-28 text-sm'>
        <img className='w-full md:max-w-[360px]' src={assets.contact_image} alt="" />
        <div className='flex flex-col justify-center items-start gap-6 flex-1'>
          <p className='font-semibold text-lg text-gray-600'>OUR OFFICE</p>
          <p className='text-gray-500'>54709 Willms Station <br /> Suite 350, Washington, USA</p>
          <p className='text-gray-500'>Tel: (415) 555-0132 <br /> Email: customersupport@appointy.in</p>

          <form onSubmit={handleSubmit} className='w-full max-w-md flex flex-col gap-3'>
            <p className='font-semibold text-lg text-gray-600'>SEND US A MESSAGE</p>
            <input className='border rounded p-2' placeholder='Name' value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className='border rounded p-2' type='email' placeholder='Email' value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <textarea className='border rounded p-2' rows={4} placeholder='Message' value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} required />
            <button disabled={loading} className='bg-primary text-white py-2 rounded-full'>
              {loading ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default Contact
