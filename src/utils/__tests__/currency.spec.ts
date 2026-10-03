import { describe, expect, it } from 'vitest'

import { formatINR } from '@/utils/currency'

describe('formatINR', () => {
  it.each([
    [0, '₹0'],
    [6, '₹6'],
    [15000, '₹15,000'],
    [100000, '₹1,00,000'],
    [1234567, '₹12,34,567'],
  ])('formats %i as %s', (value, expected) => {
    expect(formatINR(value)).toBe(expected)
  })

  it.each([
    [450.5, '₹450.50'],
    [1499.6, '₹1,499.60'],
    [0.25, '₹0.25'],
    [15750.75, '₹15,750.75'],
  ])('shows paise for %s as %s', (value, expected) => {
    expect(formatINR(value)).toBe(expected)
  })

  it('rounds to two decimal places', () => {
    expect(formatINR(10.456)).toBe('₹10.46')
    expect(formatINR(10.001)).toBe('₹10')
  })

  it('never prints negative zero', () => {
    expect(formatINR(-0)).toBe('₹0')
    expect(formatINR(-0.001)).toBe('₹0')
  })
})
