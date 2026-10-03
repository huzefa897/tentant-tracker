// Prototype persistence: one browser, can be cleared, doesn't sync. Replaced by a backend later.

import type { RentEntry } from '@/types/rentEntry'
import type { RentEntryStorage } from '@/types/rentEntryStorage'
import { isValidIsoTimestamp } from '@/utils/date'
import { validateRentEntryInput } from '@/utils/rentEntryValidation'

export const RENT_ENTRIES_STORAGE_KEY = 'rent-tracker:rent-entries:v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

// Checks the shape (JSON.parse proves nothing about types), then the same rules as the form.
function toRentEntry(value: unknown, index: number): RentEntry {
  const fail = (reason: string): never => {
    throw new Error(`Stored rent entry ${index} is invalid: ${reason}`)
  }

  if (!isRecord(value)) return fail('not an object')
  if (!isNonEmptyString(value.id)) return fail('id')
  if (!isNonEmptyString(value.tenantId)) return fail('tenantId')
  if (typeof value.billingMonth !== 'string') return fail('billingMonth')

  const numbers = [
    'rentAmount',
    'electricityUnits',
    'electricityRate',
    'waterAmount',
    'totalPaid',
  ] as const
  for (const key of numbers) {
    if (typeof value[key] !== 'number') return fail(key)
  }

  if (value.paidDate !== null && typeof value.paidDate !== 'string') return fail('paidDate')
  if (typeof value.notes !== 'string') return fail('notes')
  if (typeof value.createdAt !== 'string' || !isValidIsoTimestamp(value.createdAt)) {
    return fail('createdAt')
  }

  // Copy only known fields so unexpected extra data never reaches the app.
  const entry: RentEntry = {
    id: value.id,
    tenantId: value.tenantId,
    billingMonth: value.billingMonth,
    rentAmount: value.rentAmount as number,
    electricityUnits: value.electricityUnits as number,
    electricityRate: value.electricityRate as number,
    waterAmount: value.waterAmount as number,
    totalPaid: value.totalPaid as number,
    paidDate: value.paidDate,
    notes: value.notes,
    createdAt: value.createdAt,
  }

  const errors = Object.keys(validateRentEntryInput(entry))
  if (errors.length > 0) fail(errors.join(', '))

  return entry
}

// Throws if stored data is unreadable or invalid. Callers must not treat that as "no
// entries": saving over it would destroy the user's data.
export function loadRentEntries(): RentEntry[] {
  const raw = localStorage.getItem(RENT_ENTRIES_STORAGE_KEY)
  if (raw === null) return []

  const parsed: unknown = JSON.parse(raw)

  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error('Stored rent entries have an unknown format.')
  }

  const entries = parsed.entries.map(toRentEntry)

  const ids = new Set<string>()
  const tenantMonths = new Set<string>()
  for (const entry of entries) {
    const tenantMonth = `${entry.tenantId}|${entry.billingMonth}`

    if (ids.has(entry.id) || tenantMonths.has(tenantMonth)) {
      throw new Error('Stored rent entries contain duplicates.')
    }

    ids.add(entry.id)
    tenantMonths.add(tenantMonth)
  }

  return entries
}

// Can throw (quota exceeded, storage disabled); the store turns that into user feedback.
export function saveRentEntries(entries: RentEntry[]): void {
  const payload: RentEntryStorage = {
    version: 1,
    entries,
  }

  localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, JSON.stringify(payload))
}
