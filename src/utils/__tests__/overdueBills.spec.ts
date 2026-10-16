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
    [1, '1 day overdue'],
    [34, '34 days overdue'],
  ])('%i → %s', (days, text) => {
    expect(formatDaysOverdue(days)).toBe(text)
  })
})
