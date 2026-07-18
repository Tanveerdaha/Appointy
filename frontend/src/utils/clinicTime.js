/**
 * Clinic wall-clock helpers (IANA timezone).
 * Mirrors backend/utils/slotTime.js so slots match server validation.
 */

export const DEFAULT_SCHEDULING_CONFIG = {
  timeZone: 'Asia/Karachi',
  workStartHour: 10,
  workEndHour: 21,
  slotIntervalMinutes: 30,
}

const WEEKDAY_TO_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
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

export const toClinicParts = (date, timeZone) => {
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

export const getClinicOffsetMinutes = (date, timeZone) => {
  const p = toClinicParts(date, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - date.getTime()) / 60_000)
}

export const fromClinicParts = (
  { year, month, day, hour, minute = 0, second = 0 },
  timeZone
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

/** Same 12h format as backend format12h / slots_booked cache. */
export const format12h = (hour, minute) => {
  const period = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${pad2(h12)}:${pad2(minute)} ${period}`
}

/** ISO-8601 with clinic offset for this instant (not browser offset). */
export const toClinicOffsetISOString = (date, timeZone) => {
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

/**
 * Build 7 days of available slots in clinic wall time.
 * @returns {Array<Array<{datetime: Date, time: string, slotDate: string, startTime: string, dayOfMonth: number, weekday: number}>>}
 */
export const buildAvailableSlots = (docInfo, config, now = new Date()) => {
  const {
    timeZone,
    workStartHour,
    workEndHour,
    slotIntervalMinutes,
  } = { ...DEFAULT_SCHEDULING_CONFIG, ...config }

  const slots_booked = docInfo?.slots_booked || {}
  const todayParts = toClinicParts(now, timeZone)
  const allSlots = []

  for (let i = 0; i < 7; i++) {
    const dayAnchor = fromClinicParts(
      {
        year: todayParts.year,
        month: todayParts.month,
        day: todayParts.day + i,
        hour: 12,
        minute: 0,
        second: 0,
      },
      timeZone
    )
    const dayParts = toClinicParts(dayAnchor, timeZone)
    const timeSlots = []

    for (
      let minutes = workStartHour * 60;
      minutes < workEndHour * 60;
      minutes += slotIntervalMinutes
    ) {
      const hour = Math.floor(minutes / 60)
      const minute = minutes % 60
      const datetime = fromClinicParts(
        {
          year: dayParts.year,
          month: dayParts.month,
          day: dayParts.day,
          hour,
          minute,
          second: 0,
        },
        timeZone
      )

      if (datetime.getTime() <= now.getTime()) continue

      const formattedTime = format12h(hour, minute)
      const slotDate = `${dayParts.day}_${dayParts.month}_${dayParts.year}`
      const isSlotAvailable =
        !slots_booked[slotDate] || !slots_booked[slotDate].includes(formattedTime)

      if (isSlotAvailable) {
        timeSlots.push({
          datetime,
          time: formattedTime,
          slotDate,
          startTime: toClinicOffsetISOString(datetime, timeZone),
          dayOfMonth: dayParts.day,
          weekday: dayParts.weekday,
        })
      }
    }

    timeSlots.dayOfMonth = dayParts.day
    timeSlots.weekday = dayParts.weekday
    allSlots.push(timeSlots)
  }

  return allSlots
}
