import { describe, expect, it } from 'vitest'

import {
  formatMonthCount,
  formatPeriodTiming,
  formatTenantCount,
  recentMonths,
  validateNotOwedReason,
} from '@/utils/rentalPeriods'

describe('rentalPeriods utils', () => {
  it('counts months and tenants apart', () => {
    expect(formatMonthCount(1)).toBe('1 month')
    expect(formatMonthCount(3)).toBe('3 months')
    expect(formatTenantCount(0)).toBe('0 tenants')
    expect(formatTenantCount(1)).toBe('1 tenant')
  })

  it('says how late or how soon a month is due', () => {
    expect(formatPeriodTiming('overdue', 1, '2026-10-14', '2026-10-15')).toBe('Overdue 1 day')
    expect(formatPeriodTiming('overdue', 25, '2026-09-20', '2026-10-15')).toBe('Overdue 25 days')
    expect(formatPeriodTiming('due_today', 0, '2026-10-15', '2026-10-15')).toBe('Due today')
    expect(formatPeriodTiming('upcoming', 0, '2026-10-16', '2026-10-15')).toBe('Due in 1 day')
    expect(formatPeriodTiming('upcoming', 0, '2026-11-01', '2026-10-28')).toBe('Due in 4 days')
  })

  it('offers this month and the ones before it, newest first', () => {
    expect(recentMonths('2026-02-10', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11'])
    expect(recentMonths('2026-10-15')).toHaveLength(12)
  })

  it('needs a reason of at most 500 characters', () => {
    expect(validateNotOwedReason('  ')).toBe("Say why this month isn't owed.")
    expect(validateNotOwedReason('x'.repeat(501))).toBe(
      'The reason must be 500 characters or fewer.',
    )
    expect(validateNotOwedReason(' Settled in cash ')).toBeNull()
  })
})
