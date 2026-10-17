import { describe, expect, it } from 'vitest'

import { formatDaysOverdue, formatOverdueBillCount } from '@/utils/overdueBills'

describe('formatOverdueBillCount', () => {
  it.each([
    [1, '1 overdue bill'],
    [2, '2 overdue bills'],
  ])('%i → %s', (count, text) => {
    expect(formatOverdueBillCount(count)).toBe(text)
  })
})

describe('formatDaysOverdue', () => {
  it.each([
    [1, 'Overdue 1 day'],
    [34, 'Overdue 34 days'],
  ])('%i → %s', (days, text) => {
    expect(formatDaysOverdue(days)).toBe(text)
  })
})
