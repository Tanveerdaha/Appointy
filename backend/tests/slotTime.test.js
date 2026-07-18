import {
  getClinicTimeZone,
  getClinicOffsetMinutes,
  toClinicParts,
  fromClinicParts,
  isWithinWorkingHours,
  toClinicOffsetISOString,
  toLegacySlotFields,
  getSchedulingConfig,
  DEFAULT_CLINIC_TIMEZONE,
} from '../utils/slotTime.js'

describe('slotTime IANA clinic timezone', () => {
  beforeEach(() => {
    process.env.SCHEDULING_TIMEZONE = 'Asia/Karachi'
  })

  afterEach(() => {
    delete process.env.SCHEDULING_TIMEZONE
  })

  test('getClinicTimeZone defaults to Asia/Karachi', () => {
    delete process.env.SCHEDULING_TIMEZONE
    expect(getClinicTimeZone()).toBe(DEFAULT_CLINIC_TIMEZONE)
  })

  test('getClinicTimeZone falls back on invalid IANA id', () => {
    process.env.SCHEDULING_TIMEZONE = 'Not/A_Real_Zone'
    expect(getClinicTimeZone()).toBe(DEFAULT_CLINIC_TIMEZONE)
  })

  test('toClinicParts maps +05:00 instant to clinic 10:00', () => {
    const date = new Date('2030-07-22T10:00:00+05:00')
    const parts = toClinicParts(date)
    expect(parts).toMatchObject({
      year: 2030,
      month: 7,
      day: 22,
      hour: 10,
      minute: 0,
      second: 0,
    })
  })

  test('toClinicParts maps 10:00Z to clinic 15:00', () => {
    const date = new Date('2030-07-22T10:00:00Z')
    const parts = toClinicParts(date)
    expect(parts).toMatchObject({
      year: 2030,
      month: 7,
      day: 22,
      hour: 15,
      minute: 0,
    })
  })

  test('fromClinicParts builds absolute instant for clinic wall time', () => {
    const date = fromClinicParts({ year: 2030, month: 7, day: 22, hour: 10, minute: 0 })
    expect(date.toISOString()).toBe('2030-07-22T05:00:00.000Z')
  })

  test('fromClinicParts ↔ toClinicParts round-trip', () => {
    const original = { year: 2030, month: 12, day: 31, hour: 20, minute: 30, second: 0 }
    const date = fromClinicParts(original)
    const parts = toClinicParts(date)
    expect(parts).toMatchObject(original)
  })

  test('isWithinWorkingHours accepts clinic 10:00 and rejects 21:00', () => {
    expect(isWithinWorkingHours(new Date('2030-07-22T10:00:00+05:00'))).toBe(true)
    expect(isWithinWorkingHours(new Date('2030-07-22T20:30:00+05:00'))).toBe(true)
    expect(isWithinWorkingHours(new Date('2030-07-22T21:00:00+05:00'))).toBe(false)
    expect(isWithinWorkingHours(new Date('2030-07-22T09:30:00+05:00'))).toBe(false)
  })

  test('UTC 10:00 is clinic 15:00 and still within working hours', () => {
    const date = new Date('2030-07-22T10:00:00Z')
    expect(toClinicParts(date).hour).toBe(15)
    expect(isWithinWorkingHours(date)).toBe(true)
  })

  test('toClinicOffsetISOString uses clinic offset not browser', () => {
    const date = fromClinicParts({ year: 2030, month: 7, day: 22, hour: 10, minute: 0 })
    expect(toClinicOffsetISOString(date)).toBe('2030-07-22T10:00:00+05:00')
  })

  test('toLegacySlotFields uses clinic wall clock', () => {
    const date = new Date('2030-07-22T05:00:00.000Z')
    expect(toLegacySlotFields(date)).toEqual({
      slotDate: '22_7_2030',
      slotTime: '10:00 AM',
    })
  })

  test('getClinicOffsetMinutes is +300 for Asia/Karachi', () => {
    expect(getClinicOffsetMinutes(new Date('2030-07-22T05:00:00.000Z'))).toBe(300)
  })

  test('getSchedulingConfig exposes shared contract', () => {
    expect(getSchedulingConfig()).toEqual({
      timeZone: 'Asia/Karachi',
      workStartHour: 10,
      workEndHour: 21,
      slotIntervalMinutes: 30,
    })
  })
})
