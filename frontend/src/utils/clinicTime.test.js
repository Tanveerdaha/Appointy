import { describe, it, expect } from 'vitest'
import {
  toClinicParts,
  fromClinicParts,
  toClinicOffsetISOString,
  format12h,
  buildAvailableSlots,
  DEFAULT_SCHEDULING_CONFIG,
} from './clinicTime'

describe('clinicTime', () => {
  const tz = 'Asia/Karachi'

  it('serializes clinic 10:00 with +05:00, not browser offset', () => {
    const date = fromClinicParts({ year: 2030, month: 7, day: 22, hour: 10, minute: 0 }, tz)
    expect(toClinicOffsetISOString(date, tz)).toBe('2030-07-22T10:00:00+05:00')
    expect(date.toISOString()).toBe('2030-07-22T05:00:00.000Z')
  })

  it('format12h matches backend slots_booked style', () => {
    expect(format12h(10, 0)).toBe('10:00 AM')
    expect(format12h(15, 30)).toBe('03:30 PM')
  })

  it('buildAvailableSlots uses clinic wall time and filters booked slots', () => {
    const now = new Date('2030-07-22T04:00:00.000Z') // 09:00 clinic — before open
    const slots = buildAvailableSlots(
      {
        slots_booked: {
          '22_7_2030': ['10:00 AM'],
        },
      },
      DEFAULT_SCHEDULING_CONFIG,
      now
    )

    const today = slots[0]
    expect(today.dayOfMonth).toBe(22)
    expect(today[0].startTime).toBe('2030-07-22T10:30:00+05:00')
    expect(today.some((s) => s.time === '10:00 AM')).toBe(false)
    expect(today.some((s) => s.time === '10:30 AM')).toBe(true)

    const parts = toClinicParts(today[0].datetime, tz)
    expect(parts.hour).toBe(10)
    expect(parts.minute).toBe(30)
  })
})
