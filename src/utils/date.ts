// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 21 -> "21st"
export function formatOrdinal(value: number): string {
  const mod100 = value % 100

  if (mod100 >= 11 && mod100 <= 13) {
    return `${value}th`
  }

  switch (value % 10) {
    case 1:
      return `${value}st`
    case 2:
      return `${value}nd`
    case 3:
      return `${value}rd`
    default:
      return `${value}th`
  }
}

const MONTH_VALUE = /^(\d{4})-(0[1-9]|1[0-2])$/
const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

// Local date -> "2026-09", the value format of <input type="month">
export function toMonthValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

// Local date -> "2026-09-14", the value format of <input type="date">
export function toDateValue(date: Date): string {
  return `${toMonthValue(date)}-${pad(date.getDate())}`
}

export function isValidMonthValue(value: string): boolean {
  return MONTH_VALUE.test(value)
}

// Rejects impossible days such as "2026-02-30".
export function isValidDateValue(value: string): boolean {
  const match = DATE_VALUE.exec(value)
  if (!match) return false

  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const date = new Date(year, month - 1, day)

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

// "2026-09" -> "September 2026"
export function formatMonthValue(value: string): string {
  const match = MONTH_VALUE.exec(value)
  if (!match) return value

  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1)
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

const ISO_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/

// Milliseconds at most, which every browser parses (Django sends microseconds).
function toParsableTimestamp(value: string): string | null {
  const match = ISO_TIMESTAMP.exec(value)
  if (!match) return null
  const fraction = match[2] ? `.${match[2].slice(0, 3)}` : ''
  return `${match[1]}${fraction}${match[3]}`
}

// "2026-10-03T06:00:00.000Z" (Date#toISOString) or "2026-10-06T20:48:30.976041+05:30" (Django:
// microseconds, with an offset). Date.parse alone rolls impossible days over ("02-30" ->
// March), so check the date part too.
export function isValidIsoTimestamp(value: string): boolean {
  const parsable = toParsableTimestamp(value)
  return (
    parsable !== null && isValidDateValue(value.slice(0, 10)) && !Number.isNaN(Date.parse(parsable))
  )
}

// "2026-10-01" -> "1 Oct 2026"
export function formatDateValue(value: string): string {
  if (!isValidDateValue(value)) return value

  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ISO timestamp -> "3 Oct 2026, 11:30 am" in the viewer's time zone.
export function formatTimestamp(value: string): string {
  if (!isValidIsoTimestamp(value)) return value

  return new Date(toParsableTimestamp(value)!).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// "2026-01" -> "2025-12". Invalid input is returned unchanged.
export function previousMonthValue(value: string): string {
  const match = MONTH_VALUE.exec(value)
  if (!match) return value

  return toMonthValue(new Date(Number(match[1]), Number(match[2]) - 2, 1))
}

// "2026-10-04" -> "04/10/2026" (day first, as on Indian receipts).
export function formatDateValueNumeric(value: string): string {
  if (!isValidDateValue(value)) return value

  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}
