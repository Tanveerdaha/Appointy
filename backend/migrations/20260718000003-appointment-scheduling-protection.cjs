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
 *
 * Preflight: aborts before schema changes if legacy slots are unparseable or would
 * violate UNIQUE(docId, heldStartTime). Never substitutes createdAt for appointment time.
 */

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

const DEFAULT_CLINIC_TIMEZONE = 'Asia/Karachi'

const isValidTimeZone = (tz) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const getClinicTimeZone = () => {
  const raw = process.env.SCHEDULING_TIMEZONE
  const tz = raw === undefined || raw === '' ? DEFAULT_CLINIC_TIMEZONE : String(raw).trim()
  return isValidTimeZone(tz) ? tz : DEFAULT_CLINIC_TIMEZONE
}

const partsFormatterCache = new Map()

const getPartsFormatter = (timeZone) => {
  let fmt = partsFormatterCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    partsFormatterCache.set(timeZone, fmt)
  }
  return fmt
}

const toClinicParts = (date, timeZone = getClinicTimeZone()) => {
  const map = {}
  for (const part of getPartsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

const fromClinicParts = ({ year, month, day, hour, minute = 0 }, timeZone = getClinicTimeZone()) => {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  let instant = desiredAsUtc
  for (let i = 0; i < 2; i++) {
    const got = toClinicParts(new Date(instant), timeZone)
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second)
    instant += desiredAsUtc - gotAsUtc
  }
  return new Date(instant)
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

const resolveLegacyStatus = (row) => {
  if (row.cancelled) return 'CANCELLED'
  if (row.isCompleted) return 'COMPLETED'
  if (row.paymentStatus === 'pending') return 'PENDING_PAYMENT'
  return 'CONFIRMED'
}

const SLOT_HOLDING = new Set(['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED'])

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT id, docId, cancelled, isCompleted, paymentStatus, slotDate, slotTime FROM appointments`
    )

    const unparseable = []
    const slotMap = new Map()
    const duplicates = []

    for (const row of rows) {
      const status = resolveLegacyStatus(row)
      const parsed = parseLegacySlot(row.slotDate, row.slotTime)

      if (!parsed) {
        unparseable.push({
          id: row.id,
          docId: row.docId,
          slotDate: row.slotDate,
          slotTime: row.slotTime,
        })
        continue
      }

      if (!SLOT_HOLDING.has(status)) continue

      const key = `${row.docId}|${parsed.toISOString()}`
      if (slotMap.has(key)) {
        const existing = slotMap.get(key)
        const entry = duplicates.find((d) => d.key === key)
        if (entry) {
          entry.ids.push(row.id)
        } else {
          duplicates.push({ key, ids: [existing, row.id] })
        }
      } else {
        slotMap.set(key, row.id)
      }
    }

    if (unparseable.length || duplicates.length) {
      const parts = []
      if (unparseable.length) {
        parts.push(
          `${unparseable.length} unparseable legacy slots: ${JSON.stringify(unparseable.slice(0, 20))}`
        )
      }
      if (duplicates.length) {
        parts.push(
          `${duplicates.length} duplicate held doctor slots: ${JSON.stringify(duplicates.slice(0, 20))}`
        )
      }
      throw new Error(`Migration aborted: ${parts.join('; ')}`)
    }

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

    for (const row of rows) {
      const status = resolveLegacyStatus(row)
      const startTime = parseLegacySlot(row.slotDate, row.slotTime)
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
