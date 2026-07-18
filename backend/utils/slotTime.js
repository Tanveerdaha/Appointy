/**
 * Canonical appointment slot helpers.
 * Clinic wall-clock times use SCHEDULING_UTC_OFFSET_MINUTES (default +05:00).
 */

export const SLOT_INTERVAL_MINUTES = 30
export const WORK_START_HOUR = 10
export const WORK_END_HOUR = 21 // slots run while start < 21:00 → last slot 20:30

export const getClinicOffsetMinutes = () => {
  const raw = process.env.SCHEDULING_UTC_OFFSET_MINUTES
  if (raw === undefined || raw === '') return 300
  const n = Number(raw)
  return Number.isFinite(n) ? n : 300
}

const pad2 = (n) => String(n).padStart(2, '0')

/** Wall-clock parts in the clinic timezone for an absolute Date. */
export const toClinicParts = (date, offsetMinutes = getClinicOffsetMinutes()) => {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(), // 0=Sun
  }
}

/** Build a Date from clinic wall-clock components. */
export const fromClinicParts = (
  { year, month, day, hour, minute = 0, second = 0 },
  offsetMinutes = getClinicOffsetMinutes()
) => {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000
  return new Date(utcMs)
}

export const format12h = (hour, minute) => {
  const period = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${pad2(h12)}:${pad2(minute)} ${period}`
}

export const toLegacySlotFields = (date) => {
  const p = toClinicParts(date)
  return {
    slotDate: `${p.day}_${p.month}_${p.year}`,
    slotTime: format12h(p.hour, p.minute),
  }
}

/** Parse "10:00 AM" / "10:00 am" / "10:00" → { hour, minute } or null. */
export const parseSlotTimeString = (slotTime) => {
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

/** Parse legacy slotDate "20_7_2026" + slotTime into an absolute Date. */
export const parseLegacySlot = (slotDate, slotTime) => {
  if (!slotDate || !slotTime) return null
  const parts = String(slotDate).split('_').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  const [day, month, year] = parts
  const time = parseSlotTimeString(slotTime)
  if (!time) return null
  return fromClinicParts({ year, month, day, hour: time.hour, minute: time.minute })
}

/**
 * Parse client startTime (ISO-8601). Rejects invalid / missing timezone-less ambiguous forms
 * that lack a numeric offset or Z — except bare local forms we still accept if Date can parse.
 */
export const parseStartTimeInput = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  // Require explicit offset or Z for production-safe identity.
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)
  if (!hasZone) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export const isAlignedToSlotInterval = (date) => {
  const p = toClinicParts(date)
  if (p.second !== 0) return false
  return p.minute % SLOT_INTERVAL_MINUTES === 0
}

export const isWithinWorkingHours = (date) => {
  const p = toClinicParts(date)
  if (!isAlignedToSlotInterval(date)) return false
  const minutes = p.hour * 60 + p.minute
  const start = WORK_START_HOUR * 60
  const end = WORK_END_HOUR * 60
  // Valid starts: [10:00, 20:30]
  return minutes >= start && minutes < end
}

export const isFutureSlot = (date, now = new Date()) => date.getTime() > now.getTime()

/** Normalize to exact millisecond for unique comparisons. */
export const normalizeStartTime = (date) => {
  const p = toClinicParts(date)
  return fromClinicParts({
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
    second: 0,
  })
}
