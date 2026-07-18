import { parseLegacySlot } from './slotTime.js'

/** Snapshot fields stored on appointments — no secrets or slot maps. */
export const toSafeDoctorSnapshot = (doctor) => {
  const data = typeof doctor.toJSON === 'function' ? doctor.toJSON() : doctor
  return {
    id: data.id,
    name: data.name,
    image: data.image,
    speciality: data.speciality,
    degree: data.degree,
    experience: data.experience,
    fees: data.fees,
    address: data.address,
  }
}

/** Best-effort startTime from legacy fields (used by migration repair / seeds). */
export const legacySlotToStartTime = (slotDate, slotTime, fallback = new Date()) => {
  return parseLegacySlot(slotDate, slotTime) || fallback
}
