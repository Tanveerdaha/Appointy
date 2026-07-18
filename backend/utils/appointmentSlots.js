import sequelize from '../config/mysql.js'
import Appointment from '../models/appointmentModel.js'
import { lockDoctorForUpdate } from './lockDoctor.js'
import { parseLegacySlot, toLegacySlotFields } from './slotTime.js'

/**
 * Mark appointment cancelled and release the doctor slot under a row lock.
 * Clears heldStartTime so the unique doctor/slot index allows rebooking.
 */
export const cancelAppointmentAndReleaseSlot = async (
  appointment,
  { extraAppointmentFields = {} } = {}
) => {
  const transaction = await sequelize.transaction()
  try {
    await Appointment.update(
      {
        cancelled: true,
        status: 'CANCELLED',
        heldStartTime: null,
        ...extraAppointmentFields,
      },
      { where: { id: appointment.id }, transaction }
    )

    const doctor = await lockDoctorForUpdate(appointment.docId, transaction)
    if (doctor) {
      const legacy = appointment.startTime
        ? toLegacySlotFields(new Date(appointment.startTime))
        : { slotDate: appointment.slotDate, slotTime: appointment.slotTime }
      const slots_booked = { ...(doctor.slots_booked || {}) }
      if (slots_booked[legacy.slotDate]) {
        slots_booked[legacy.slotDate] = slots_booked[legacy.slotDate].filter(
          (t) => t !== legacy.slotTime
        )
      }
      await doctor.update({ slots_booked }, { transaction })
    }

    await transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
  }
}

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
