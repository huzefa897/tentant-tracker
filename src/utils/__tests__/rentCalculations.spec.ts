import { describe, expect, it } from 'vitest'

import {
  calculateElectricity,
  calculateOutstanding,
  calculateTotalDue,
  formatPaymentStatus,
  getPaymentStatus,
} from '@/utils/rentCalculations'

const charges = { rentAmount: 15000, electricityUnits: 75, electricityRate: 6, waterAmount: 300 }

describe('calculateElectricity', () => {
  it('multiplies units by the rate', () => {
    expect(calculateElectricity(75, 6)).toBe(450)
  })

  it('is zero when nothing was consumed', () => {
    expect(calculateElectricity(0, 6)).toBe(0)
  })

  it('rounds to paise', () => {
    expect(calculateElectricity(75, 6.01)).toBe(450.75)
    expect(calculateElectricity(3, 0.1)).toBe(0.3)
    expect(calculateElectricity(1, 1.005)).toBe(1.01)
  })
})

describe('calculateTotalDue', () => {
  it('adds rent, electricity and water', () => {
    expect(calculateTotalDue(charges)).toBe(15750)
  })

  it('handles no electricity or water', () => {
    expect(calculateTotalDue({ ...charges, electricityUnits: 0, waterAmount: 0 })).toBe(15000)
  })

  it('avoids floating point drift', () => {
    expect(
      calculateTotalDue({
        ...charges,
        electricityUnits: 3,
        electricityRate: 0.1,
        waterAmount: 0.2,
      }),
    ).toBe(15000.5)
  })
})

describe('calculateOutstanding', () => {
  it.each([
    [15750, 0, 15750],
    [15750, 10000, 5750],
    [15750, 15750, 0],
    [0.3, 0.1, 0.2],
  ])('due %s, paid %s -> %s outstanding', (due, paid, expected) => {
    expect(calculateOutstanding(due, paid)).toBe(expected)
  })
})

describe('getPaymentStatus', () => {
  it.each([
    [15750, 0, 'unpaid'],
    [15750, 10000, 'partially_paid'],
    [15750, 0.01, 'partially_paid'],
    [15750, 15750, 'paid'],
    [0.3, 0.1 + 0.2, 'paid'],
  ] as const)('due %s, paid %s -> %s', (due, paid, expected) => {
    expect(getPaymentStatus(due, paid)).toBe(expected)
  })
})

describe('formatPaymentStatus', () => {
  it.each([
    ['unpaid', 'Unpaid'],
    ['partially_paid', 'Partially paid'],
    ['paid', 'Paid'],
  ] as const)('labels %s as %s', (status, label) => {
    expect(formatPaymentStatus(status)).toBe(label)
  })
})
