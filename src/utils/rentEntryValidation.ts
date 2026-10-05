// Rent entry (bill) rules, used by the form for inline errors and again before saving.
// Payment rules live in utils/paymentValidation.ts.

import type { RentEntryInput } from '@/types/rentEntry'
import { isValidMonthValue } from '@/utils/date'
import { hasAtMostDecimals } from '@/utils/money'
import { calculateTotalDue } from '@/utils/rentCalculations'

export const NOTES_MAX_LENGTH = 500

// The backend stores money with 2 decimal places and units with 3, in at most 10 digits.
export const MAX_AMOUNT = 99_999_999.99
export const MAX_UNITS = 9_999_999.999

// '' is an empty input ("not entered"), which is different from 0.
export type NumberInputValue = number | ''

// The unfinished bill, as typed.
export interface RentEntryDraft {
  billingMonth: string
  rentAmount: NumberInputValue
  electricityUnits: NumberInputValue
  electricityRate: number
  waterAmount: NumberInputValue
  notes: string
}

export type RentEntryErrors = Partial<Record<keyof RentEntryDraft | 'tenantId', string>>

export type ParsedRentEntry =
  { ok: true; input: RentEntryInput } | { ok: false; errors: RentEntryErrors }

// A finite number, or null for empty/invalid input. Inputs can produce '' or non-numeric
// strings at runtime whatever their declared type, so check the value itself.
export function toAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// Total due, or null while a charge is missing or invalid (so the UI never shows a misleading total).
export function getDraftTotalDue(draft: RentEntryDraft): number | null {
  const rentAmount = toAmount(draft.rentAmount)
  const electricityUnits = toAmount(draft.electricityUnits)
  const electricityRate = toAmount(draft.electricityRate)
  const waterAmount = toAmount(draft.waterAmount)

  if (
    rentAmount === null ||
    rentAmount <= 0 ||
    electricityUnits === null ||
    electricityUnits < 0 ||
    electricityRate === null ||
    electricityRate < 0 ||
    waterAmount === null ||
    waterAmount < 0
  ) {
    return null
  }

  return calculateTotalDue({ rentAmount, electricityUnits, electricityRate, waterAmount })
}

function nonNegativeError(
  value: NumberInputValue,
  emptyMessage: string,
  label: string,
  places: number,
  max: number,
) {
  const amount = toAmount(value)
  if (amount === null) return emptyMessage
  if (amount < 0) return `${label} cannot be negative.`
  return precisionError(amount, label, places, max)
}

function precisionError(amount: number, label: string, places: number, max: number) {
  if (!hasAtMostDecimals(amount, places)) return `${label} can have at most ${places} decimals.`
  if (amount > max) return `${label} must be at most ${max.toLocaleString('en-IN')}.`
  return undefined
}

// Drops the keys of passing checks so `Object.keys(errors).length` means "has errors".
export function withoutPassingChecks<T extends Record<string, string | undefined>>(errors: T): T {
  for (const key of Object.keys(errors) as (keyof T)[]) {
    if (!errors[key]) delete errors[key]
  }
  return errors
}

export function validateRentEntryDraft(draft: RentEntryDraft): RentEntryErrors {
  const errors: RentEntryErrors = {}

  if (!isValidMonthValue(draft.billingMonth)) {
    errors.billingMonth = 'Select the billing month.'
  }

  const rentAmount = toAmount(draft.rentAmount)
  if (rentAmount === null || rentAmount <= 0) {
    errors.rentAmount = 'Enter a rent amount greater than zero.'
  } else {
    errors.rentAmount = precisionError(rentAmount, 'Rent amount', 2, MAX_AMOUNT)
  }

  errors.electricityUnits = nonNegativeError(
    draft.electricityUnits,
    'Enter electricity units, or use 0 if there was no consumption.',
    'Electricity units',
    3,
    MAX_UNITS,
  )

  const electricityRate = toAmount(draft.electricityRate)
  if (electricityRate === null || electricityRate < 0) {
    errors.electricityRate = "This tenant's electricity rate is invalid."
  }

  errors.waterAmount = nonNegativeError(
    draft.waterAmount,
    'Enter the water amount, or use 0 if there is none.',
    'Water amount',
    2,
    MAX_AMOUNT,
  )

  if (draft.notes.length > NOTES_MAX_LENGTH) {
    errors.notes = `Notes must be ${NOTES_MAX_LENGTH} characters or fewer.`
  }

  return withoutPassingChecks(errors)
}

// The same rules for a complete entry, used before saving it and when loading saved entries.
export function validateRentEntryInput(input: RentEntryInput): RentEntryErrors {
  const errors = validateRentEntryDraft(input)

  if (input.tenantId.trim() === '') {
    errors.tenantId = 'The entry has no tenant.'
  }

  return errors
}

export function parseRentEntryDraft(tenantId: string, draft: RentEntryDraft): ParsedRentEntry {
  const errors = validateRentEntryDraft(draft)
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  // Validation guarantees these are finite numbers.
  return {
    ok: true,
    input: {
      tenantId,
      billingMonth: draft.billingMonth,
      rentAmount: draft.rentAmount as number,
      electricityUnits: draft.electricityUnits as number,
      electricityRate: draft.electricityRate,
      waterAmount: draft.waterAmount as number,
      notes: draft.notes.trim(),
    },
  }
}
