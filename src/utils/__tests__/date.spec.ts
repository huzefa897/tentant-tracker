import { describe, expect, it } from 'vitest'

import { formatOrdinal } from '@/utils/date'

describe('formatOrdinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [31, '31st'],
  ])('formats %i as %s', (value, expected) => {
    expect(formatOrdinal(value)).toBe(expected)
  })
})
