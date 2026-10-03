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

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

// "2026-10-03T06:00:00.000Z", as produced by Date#toISOString.
// Date.parse alone rolls impossible days over ("02-30" -> March), so check the date part too.
export function isValidIsoTimestamp(value: string): boolean {
  return (
    ISO_TIMESTAMP.test(value) &&
    isValidDateValue(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value))
  )
}
