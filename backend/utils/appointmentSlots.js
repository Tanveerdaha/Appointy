import sequelize from '../config/mysql.js'
import Appointment from '../models/appointmentModel.js'
import { lockDoctorForUpdate } from './lockDoctor.js'

/**
 * Mark appointment cancelled and release the doctor slot under a row lock.
 */
export const cancelAppointmentAndReleaseSlot = async (
  appointment,
  { extraAppointmentFields = {} } = {}
) => {
  const transaction = await sequelize.transaction()
  try {
    await Appointment.update(
      { cancelled: true, ...extraAppointmentFields },
      { where: { id: appointment.id }, transaction }
    )

    const doctor = await lockDoctorForUpdate(appointment.docId, transaction)
    if (doctor) {
      const slots_booked = { ...(doctor.slots_booked || {}) }
      const { slotDate, slotTime } = appointment
      if (slots_booked[slotDate]) {
        slots_booked[slotDate] = slots_booked[slotDate].filter((t) => t !== slotTime)
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
