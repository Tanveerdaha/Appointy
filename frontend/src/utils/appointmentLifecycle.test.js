import { describe, it, expect } from 'vitest'
import {
  getAppointmentStatus,
  getLifecycleActions,
  canRescheduleAppointment,
  APPOINTMENT_STATUS,
} from './appointmentLifecycle'

describe('appointmentLifecycle helpers', () => {
  it('prefers canonical status over legacy booleans', () => {
    expect(
      getAppointmentStatus({
        status: 'COMPLETED',
        cancelled: true,
        isCompleted: false,
      })
    ).toBe('COMPLETED')
  })

  it('falls back to legacy booleans when status missing', () => {
    expect(getAppointmentStatus({ cancelled: true })).toBe('CANCELLED')
    expect(getAppointmentStatus({ isCompleted: true })).toBe('COMPLETED')
  })

  it('only CONFIRMED appointments can be rescheduled', () => {
    expect(canRescheduleAppointment('CONFIRMED')).toBe(true)
    expect(canRescheduleAppointment('PENDING_PAYMENT')).toBe(false)
    expect(canRescheduleAppointment('COMPLETED')).toBe(false)
    expect(canRescheduleAppointment('CANCELLED')).toBe(false)
  })

  it('derives action visibility from status', () => {
    const confirmed = getLifecycleActions(
      { status: APPOINTMENT_STATUS.CONFIRMED },
      'unpaid'
    )
    expect(confirmed.showPay).toBe(true)
    expect(confirmed.showReschedule).toBe(true)
    expect(confirmed.showCancel).toBe(true)
    expect(confirmed.showCompleted).toBe(false)

    const completed = getLifecycleActions(
      { status: APPOINTMENT_STATUS.COMPLETED },
      'paid'
    )
    expect(completed.showCompleted).toBe(true)
    expect(completed.showPay).toBe(false)
    expect(completed.showReschedule).toBe(false)
    expect(completed.showCancel).toBe(false)

    const cancelled = getLifecycleActions(
      { status: APPOINTMENT_STATUS.CANCELLED },
      'unpaid'
    )
    expect(cancelled.showCancelled).toBe(true)
    expect(cancelled.showReschedule).toBe(false)
  })
})
