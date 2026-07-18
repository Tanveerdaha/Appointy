'use strict';

/**
 * Canonical scheduling identity + status for double-booking protection.
 *
 * - startTime: absolute appointment datetime (source of truth for when)
 * - heldStartTime: equals startTime while the slot is held; NULL when cancelled/refunded
 *   so UNIQUE(docId, heldStartTime) allows rebooking after cancel (MySQL/SQLite NULL uniqueness)
 * - status: scheduling lifecycle independent of paymentStatus
 *
 * Index name unique_doctor_slot enforces one active booking per doctor/time.
 */

const pad2 = (n) => String(n).padStart(2, '0')

const parseSlotTimeString = (slotTime) => {
  if (typeof slotTime !== 'string') return null
  const trimmed = slotTime.trim()
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match12) {
    let hour = Number(match12[1])
    const minute = Number(match12[2])
    const period = match12[3].toUpperCase()
    if (hour < 1 || hour > 12 || minute > 59) return null
    if (period === 'AM') {
      if (hour === 12) hour = 0
    } else if (hour !== 12) {
      hour += 12
    }
    return { hour, minute }
  }
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (match24) {
    const hour = Number(match24[1])
    const minute = Number(match24[2])
    if (hour > 23 || minute > 59) return null
    return { hour, minute }
  }
  return null
}

const offsetMinutes = () => {
  const raw = process.env.SCHEDULING_UTC_OFFSET_MINUTES
  if (raw === undefined || raw === '') return 300
  const n = Number(raw)
  return Number.isFinite(n) ? n : 300
}

const fromClinicParts = ({ year, month, day, hour, minute = 0 }) => {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes() * 60_000
  return new Date(utcMs)
}

const parseLegacySlot = (slotDate, slotTime) => {
  if (!slotDate || !slotTime) return null
  const parts = String(slotDate).split('_').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  const [day, month, year] = parts
  const time = parseSlotTimeString(slotTime)
  if (!time) return null
  return fromClinicParts({ year, month, day, hour: time.hour, minute: time.minute })
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('appointments', 'startTime', {
      type: Sequelize.DATE,
      allowNull: true,
    })
    await queryInterface.addColumn('appointments', 'heldStartTime', {
      type: Sequelize.DATE,
      allowNull: true,
    })
    await queryInterface.addColumn('appointments', 'status', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'CONFIRMED',
    })

    const [rows] = await queryInterface.sequelize.query(
      `SELECT id, cancelled, isCompleted, paymentStatus, createdAt, slotDate, slotTime FROM appointments`
    )

    for (const row of rows) {
      let status = 'CONFIRMED'
      if (row.cancelled) status = 'CANCELLED'
      else if (row.isCompleted) status = 'COMPLETED'
      else if (row.paymentStatus === 'pending') status = 'PENDING_PAYMENT'

      const parsed = parseLegacySlot(row.slotDate, row.slotTime)
      const startTime = parsed || new Date(row.createdAt)
      const held =
        status === 'CANCELLED' || status === 'REFUNDED' ? null : startTime

      await queryInterface.sequelize.query(
        `UPDATE appointments SET startTime = ?, heldStartTime = ?, status = ? WHERE id = ?`,
        { replacements: [startTime, held, status, row.id] }
      )
    }

    await queryInterface.changeColumn('appointments', 'startTime', {
      type: Sequelize.DATE,
      allowNull: false,
    })
    await queryInterface.changeColumn('appointments', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'CONFIRMED',
    })

    await queryInterface.addIndex('appointments', ['docId', 'heldStartTime'], {
      unique: true,
      name: 'unique_doctor_slot',
    })
    await queryInterface.addIndex('appointments', ['status'], {
      name: 'appointments_status',
    })
    await queryInterface.addIndex('appointments', ['startTime'], {
      name: 'appointments_start_time',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('appointments', 'appointments_start_time')
    await queryInterface.removeIndex('appointments', 'appointments_status')
    await queryInterface.removeIndex('appointments', 'unique_doctor_slot')
    await queryInterface.removeColumn('appointments', 'status')
    await queryInterface.removeColumn('appointments', 'heldStartTime')
    await queryInterface.removeColumn('appointments', 'startTime')
  },
}
