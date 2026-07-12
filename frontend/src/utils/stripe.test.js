import { describe, it, expect } from 'vitest'
import { getPaymentStatus } from './stripe'

describe('getPaymentStatus', () => {
  it('returns paid when paymentStatus is paid', () => {
    expect(getPaymentStatus({ paymentStatus: 'paid' })).toBe('paid')
  })

  it('returns unpaid when no payment', () => {
    expect(getPaymentStatus({ payment: false })).toBe('unpaid')
  })

  it('returns paid from legacy payment boolean', () => {
    expect(getPaymentStatus({ payment: true })).toBe('paid')
  })
})
