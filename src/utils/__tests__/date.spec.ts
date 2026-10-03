import { describe, expect, it } from 'vitest'

import {
  formatMonthValue,
  formatOrdinal,
  isValidDateValue,
  isValidIsoTimestamp,
  isValidMonthValue,
  toDateValue,
  toMonthValue,
} from '@/utils/date'

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

describe('toMonthValue / toDateValue', () => {
  it('uses the local date, zero padded', () => {
    const date = new Date(2026, 0, 5, 23, 30)

    expect(toMonthValue(date)).toBe('2026-01')
    expect(toDateValue(date)).toBe('2026-01-05')
  })

  it('handles the last day of the year', () => {
    expect(toDateValue(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('isValidMonthValue', () => {
  it.each(['2026-01', '2026-09', '2026-12'])('accepts %s', (value) => {
    expect(isValidMonthValue(value)).toBe(true)
  })

  it.each(['', '2026-13', '2026-00', '2026-9', '26-09', '2026-09-01', 'September'])(
    'rejects %j',
    (value) => {
      expect(isValidMonthValue(value)).toBe(false)
    },
  )
})

describe('isValidDateValue', () => {
  it.each(['2026-10-03', '2024-02-29', '2026-12-31'])('accepts %s', (value) => {
    expect(isValidDateValue(value)).toBe(true)
  })

  it.each(['', '2026-02-29', '2026-02-30', '2026-13-01', '2026-10-3', '03-10-2026', '2026-10'])(
    'rejects %j',
    (value) => {
      expect(isValidDateValue(value)).toBe(false)
    },
  )
})

describe('formatMonthValue', () => {
  it('formats a billing month for display', () => {
    expect(formatMonthValue('2026-09')).toBe('September 2026')
  })

  it('returns invalid input unchanged', () => {
    expect(formatMonthValue('nope')).toBe('nope')
  })
})

describe('isValidIsoTimestamp', () => {
  it.each(['2026-10-03T06:00:00.000Z', '2026-10-03T06:00:00Z', new Date(2026, 0, 1).toISOString()])(
    'accepts %s',
    (value) => {
      expect(isValidIsoTimestamp(value)).toBe(true)
    },
  )

  it.each([
    '',
    '2026-10-03',
    '2026-10-03 06:00:00',
    '2026-10-03T06:00:00+05:30',
    '2026-02-30T00:00:00Z',
    'nope',
  ])('rejects %j', (value) => {
    expect(isValidIsoTimestamp(value)).toBe(false)
  })
})
