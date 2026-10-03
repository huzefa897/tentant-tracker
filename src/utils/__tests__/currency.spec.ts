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

  it('rounds to whole rupees', () => {
    expect(formatINR(1499.6)).toBe('₹1,500')
  })
})
