import { describe, expect, it } from 'vitest'

import {
  formatDateValue,
  formatDateValueNumeric,
  formatMonthValue,
  formatOrdinal,
  formatTimestamp,
  isValidDateValue,
  isValidIsoTimestamp,
  isValidMonthValue,
  formatClockTime,
  formatTimeAgo,
  nextMonthValue,
  previousMonthValue,
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
  it.each([
    '2026-10-03T06:00:00.000Z',
    '2026-10-03T06:00:00Z',
    new Date(2026, 0, 1).toISOString(),
    '2026-10-03T06:00:00+05:30',
    '2026-10-06T20:48:30.976041+05:30',
  ])('accepts %s', (value) => {
    expect(isValidIsoTimestamp(value)).toBe(true)
  })

  it.each([
    '',
    '2026-10-03',
    '2026-10-03 06:00:00',
    '2026-10-03T06:00:00',
    '2026-10-03T06:00:00+0530',
    '2026-02-30T00:00:00Z',
    'nope',
  ])('rejects %j', (value) => {
    expect(isValidIsoTimestamp(value)).toBe(false)
  })
})

describe('formatDateValue', () => {
  it.each([
    ['2026-10-01', '1 Oct 2026'],
    ['2026-02-28', '28 Feb 2026'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatDateValue(value)).toBe(expected)
  })

  it.each(['2026-02-30', 'nope'])('returns invalid input %j unchanged', (value) => {
    expect(formatDateValue(value)).toBe(value)
  })
})

describe('formatTimestamp', () => {
  it('shows the time in the viewer’s time zone', () => {
    expect(formatTimestamp(new Date(2026, 9, 3, 11, 30).toISOString())).toBe('3 Oct 2026, 11:30 am')
  })

  it('reads Django’s timestamps, with microseconds and an offset', () => {
    const fromDjango = '2026-10-06T20:48:30.976041+05:30'

    expect(formatTimestamp(fromDjango)).toBe(
      new Date('2026-10-06T15:18:30.976Z').toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    )
    expect(formatTimestamp(fromDjango)).not.toContain('T')
  })

  it('returns invalid input unchanged', () => {
    expect(formatTimestamp('nope')).toBe('nope')
    expect(formatTimestamp('2026-02-30T10:00:00+05:30')).toBe('2026-02-30T10:00:00+05:30')
  })
})

describe('nextMonthValue', () => {
  it.each([
    ['2026-09', '2026-10'],
    ['2026-12', '2027-01'],
    ['bad', 'bad'],
  ])('%s -> %s', (value, next) => {
    expect(nextMonthValue(value)).toBe(next)
  })
})

describe('formatClockTime', () => {
  it('shows the hour and minute, am or pm', () => {
    expect(formatClockTime(new Date(2026, 9, 15, 18, 30).getTime())).toBe('6:30 pm')
    expect(formatClockTime(new Date(2026, 9, 15, 9, 5).getTime())).toBe('9:05 am')
  })
})

describe('formatTimeAgo', () => {
  const at = new Date(2026, 9, 15, 18, 30).getTime()

  it.each([
    [0, 'just now'],
    [44_000, 'just now'],
    [60_000, '1 minute ago'],
    [30 * 60_000, '30 minutes ago'],
    [60 * 60_000, '1 hour ago'],
    [5 * 60 * 60_000, '5 hours ago'],
  ])('%i ms later is %s', (later, label) => {
    expect(formatTimeAgo(at, at + later)).toBe(label)
  })

  it('gives the date and time after a day', () => {
    expect(formatTimeAgo(at, at + 25 * 60 * 60_000)).toMatch(/^on 15 Oct 2026, 6:30\s?pm$/i)
  })

  it('never says a time in the future', () => {
    expect(formatTimeAgo(at, at - 5000)).toBe('just now')
  })
})

describe('previousMonthValue', () => {
  it.each([
    ['2026-09', '2026-08'],
    ['2026-01', '2025-12'],
    ['nope', 'nope'],
  ])('%s -> %s', (value, expected) => {
    expect(previousMonthValue(value)).toBe(expected)
  })
})

describe('formatDateValueNumeric', () => {
  it('puts the day first', () => {
    expect(formatDateValueNumeric('2026-10-04')).toBe('04/10/2026')
  })

  it('returns invalid input unchanged', () => {
    expect(formatDateValueNumeric('2026-02-30')).toBe('2026-02-30')
  })
})
