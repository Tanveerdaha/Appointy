/**
 * Canonical appointment slot helpers.
 * Clinic wall-clock times use SCHEDULING_TIMEZONE (IANA, default Asia/Karachi).
 */

export const SLOT_INTERVAL_MINUTES = 30
export const WORK_START_HOUR = 10
export const WORK_END_HOUR = 21 // slots run while start < 21:00 → last slot 20:30

export const DEFAULT_CLINIC_TIMEZONE = 'Asia/Karachi'

const WEEKDAY_TO_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const isValidTimeZone = (tz) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const getClinicTimeZone = () => {
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
      weekday: 'short',
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

/** Wall-clock parts in the clinic timezone for an absolute Date. */
export const toClinicParts = (date, timeZone = getClinicTimeZone()) => {
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
    weekday: WEEKDAY_TO_INDEX[map.weekday] ?? 0,
  }
}

/**
 * UTC offset of the clinic timezone at the given instant, in minutes east of UTC.
 * e.g. Asia/Karachi → 300
 */
export const getClinicOffsetMinutes = (date = new Date(), timeZone = getClinicTimeZone()) => {
  const p = toClinicParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/** Build a Date from clinic wall-clock components (IANA-aware, DST-safe). */
export const fromClinicParts = (
  { year, month, day, hour, minute = 0, second = 0 },
  timeZone = getClinicTimeZone()
) => {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  let instant = desiredAsUtc

  for (let i = 0; i < 2; i++) {
    const got = toClinicParts(new Date(instant), timeZone)
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second)
    instant += desiredAsUtc - gotAsUtc
  }

  return new Date(instant)
}

const pad2 = (n) => String(n).padStart(2, '0')

export const format12h = (hour, minute) => {
  const period = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${pad2(h12)}:${pad2(minute)} ${period}`
}

/** ISO-8601 with numeric offset for the clinic timezone at this instant. */
export const toClinicOffsetISOString = (date, timeZone = getClinicTimeZone()) => {
  const p = toClinicParts(date, timeZone)
  const offsetMinutes = getClinicOffsetMinutes(date, timeZone)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return (
    `${p.year}-${pad2(p.month)}-${pad2(p.day)}` +
    `T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  )
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
 * Parse client startTime (ISO-8601). Requires explicit numeric offset or Z.
 */
export const parseStartTimeInput = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
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

/** Public scheduling config shared with frontends. */
export const getSchedulingConfig = () => ({
  timeZone: getClinicTimeZone(),
  workStartHour: WORK_START_HOUR,
  workEndHour: WORK_END_HOUR,
  slotIntervalMinutes: SLOT_INTERVAL_MINUTES,
})
