import type { PeriodTiming } from '@/types/dashboard'
import { previousMonthValue } from '@/utils/date'

export const NOT_OWED_REASON_MAX_LENGTH = 500

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

// "3 months", "1 month": rental periods, never tenants.
export function formatMonthCount(count: number): string {
  return plural(count, 'month', 'months')
}

export function formatTenantCount(count: number): string {
  return plural(count, 'tenant', 'tenants')
}

// Days between two YYYY-MM-DD dates (to minus from), whole days in UTC.
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

// "Overdue 4 days", "Due today", "Due in 3 days" (asOfDate: today at the property, from the
// summary, so it agrees with the backend's timing).
export function formatPeriodTiming(
  timing: PeriodTiming,
  daysOverdue: number,
  dueDate: string,
  asOfDate: string,
): string {
  if (timing === 'overdue') return `Overdue ${plural(daysOverdue, 'day', 'days')}`
  if (timing === 'due_today') return 'Due today'
  const days = daysBetween(asOfDate, dueDate)
  return days > 0 ? `Due in ${plural(days, 'day', 'days')}` : 'Upcoming'
}

// The months to offer as a filter: this month (at the property) and the `count - 1` before
// it, newest first.
export function recentMonths(asOfDate: string, count = 12): string[] {
  const months = [asOfDate.slice(0, 7)]
  while (months.length < count) months.push(previousMonthValue(months[months.length - 1]!))
  return months
}

export function validateNotOwedReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed === '') return "Say why this month isn't owed."
  if (trimmed.length > NOT_OWED_REASON_MAX_LENGTH) {
    return `The reason must be ${NOT_OWED_REASON_MAX_LENGTH} characters or fewer.`
  }
  return null
}
