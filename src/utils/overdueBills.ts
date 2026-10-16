function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

// "2 overdue bills", "1 overdue bill".
export function formatOverdueBillCount(count: number): string {
  return plural(count, 'overdue bill', 'overdue bills')
}

// "34 days overdue", "1 day overdue".
export function formatDaysOverdue(days: number): string {
  return `${plural(days, 'day', 'days')} overdue`
}
