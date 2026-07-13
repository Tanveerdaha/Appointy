import React, { useContext, useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppContext } from '../context/appContext'
import DoctorCard from '../components/DoctorCard'
import EmptyState from '../components/EmptyState'
import LoadingSpinner from '../components/LoadingSpinner'

const Doctors = () => {
  const { speciality } = useParams()
  const [filterDoc, setFilterDoc] = useState([])
  const [showFilter, setShowFilter] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const navigate = useNavigate()
  const { doctors, doctorsLoaded } = useContext(AppContext)

  useEffect(() => {
    let filtered = doctors
    if (speciality) {
      filtered = filtered.filter(doc => doc.speciality === speciality)
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(doc =>
        doc.name.toLowerCase().includes(query) ||
        doc.speciality.toLowerCase().includes(query)
      )
    }
    setFilterDoc(filtered)
  }, [doctors, speciality, searchQuery])

  if (!doctorsLoaded) return <LoadingSpinner label='Loading doctors...' />

  return (
    <div>
      <p className='text-gray-600'>Browse through the doctors specialist.</p>
      <input
        type="text"
        placeholder="Search by doctor name or specialty..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="mt-4 w-full max-w-md border border-gray-300 rounded px-4 py-2 text-sm"
      />
      <div className='flex flex-col sm:flex-row items-start gap-5 mt-5'>
        <button onClick={() => setShowFilter(!showFilter)} className={`py-1 px-3 border rounded text-sm transition-all sm:hidden ${showFilter ? 'bg-primary text-white' : ''}`}>Filters</button>
        <div className={`flex-col gap-4 text-sm text-gray-600 ${showFilter ? 'flex' : 'hidden sm:flex'}`}>
          {['General physician', 'Gynecologist', 'Dermatologist', 'Pediatricians', 'Neurologist', 'Gastroenterologist'].map((spec) => (
            <p
              key={spec}
              onClick={() => speciality === spec ? navigate('/doctors') : navigate(`/doctors/${spec}`)}
              className={`w-[94vw] sm:w-auto pl-3 py-1.5 pr-16 border border-gray-300 rounded transition-all cursor-pointer ${speciality === spec ? 'bg-[#E2E5FF] text-black' : ''}`}
            >
              {spec}
            </p>
          ))}
        </div>
        <div className='w-full grid grid-cols-auto gap-4 gap-y-6'>
          {filterDoc.length === 0 ? (
            <EmptyState title='No doctors found' message='Try a different search or specialty filter.' />
          ) : (
            filterDoc.map((item) => (
              <DoctorCard key={item.id || item._id} doctor={item} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default Doctors
