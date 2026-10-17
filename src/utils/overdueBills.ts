function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

// "2 overdue bills", "1 overdue bill".
export function formatOverdueBillCount(count: number): string {
  return plural(count, 'overdue bill', 'overdue bills')
}

// "Overdue 34 days", "Overdue 1 day": worded as Rent due's status badges are.
export function formatDaysOverdue(days: number): string {
  return `Overdue ${plural(days, 'day', 'days')}`
}
