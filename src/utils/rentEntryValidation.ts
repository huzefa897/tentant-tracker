// Rent entry rules, used by the form for inline errors and again before saving.

import type { RentEntryInput } from '@/types/rentEntry'
import { isValidDateValue, isValidMonthValue } from '@/utils/date'
import { calculateTotalDue } from '@/utils/rentCalculations'

export const NOTES_MAX_LENGTH = 500

// '' is an empty input ("not entered"), which is different from 0.
export type NumberInputValue = number | ''

// The unfinished form, as typed.
export interface RentEntryDraft {
  billingMonth: string
  rentAmount: NumberInputValue
  electricityUnits: NumberInputValue
  electricityRate: number
  waterAmount: NumberInputValue
  totalPaid: NumberInputValue
  paidDate: string
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

function nonNegativeError(value: NumberInputValue, emptyMessage: string, label: string) {
  const amount = toAmount(value)
  if (amount === null) return emptyMessage
  if (amount < 0) return `${label} cannot be negative.`
  return undefined
}

// `today` is "YYYY-MM-DD" in local time. Without it, future paid dates aren't checked
// (used for stored entries, which were checked when saved; the clock may have moved since).
export function validateRentEntryDraft(draft: RentEntryDraft, today?: string): RentEntryErrors {
  const errors: RentEntryErrors = {}

  if (!isValidMonthValue(draft.billingMonth)) {
    errors.billingMonth = 'Select the billing month.'
  }

  const rentAmount = toAmount(draft.rentAmount)
  if (rentAmount === null || rentAmount <= 0) {
    errors.rentAmount = 'Enter a rent amount greater than zero.'
  }

  errors.electricityUnits = nonNegativeError(
    draft.electricityUnits,
    'Enter electricity units, or use 0 if there was no consumption.',
    'Electricity units',
  )

  const electricityRate = toAmount(draft.electricityRate)
  if (electricityRate === null || electricityRate < 0) {
    errors.electricityRate = "This tenant's electricity rate is invalid."
  }

  errors.waterAmount = nonNegativeError(
    draft.waterAmount,
    'Enter the water amount, or use 0 if there is none.',
    'Water amount',
  )

  const totalPaid = toAmount(draft.totalPaid)
  const totalDue = getDraftTotalDue(draft)
  if (totalPaid === null) {
    errors.totalPaid = 'Enter the amount paid, or use 0 if nothing was paid.'
  } else if (totalPaid < 0) {
    errors.totalPaid = 'Total paid cannot be negative.'
  } else if (totalDue !== null && totalPaid > totalDue) {
    errors.totalPaid = 'Total paid cannot exceed the total due.'
  }

  // Only one payment per entry for now: a date is needed exactly when something was paid.
  if (totalPaid !== null && totalPaid > 0) {
    if (!isValidDateValue(draft.paidDate)) {
      errors.paidDate = 'Select the date this payment was received.'
    } else if (today !== undefined && draft.paidDate > today) {
      errors.paidDate = 'Paid date cannot be in the future.'
    }
  }

  if (draft.notes.length > NOTES_MAX_LENGTH) {
    errors.notes = `Notes must be ${NOTES_MAX_LENGTH} characters or fewer.`
  }

  // Drop the keys of passing checks so `Object.keys(errors).length` means "has errors".
  for (const key of Object.keys(errors) as (keyof RentEntryErrors)[]) {
    if (!errors[key]) delete errors[key]
  }

  return errors
}

// The same rules for a complete entry, used before saving it and when loading saved entries.
export function validateRentEntryInput(input: RentEntryInput, today?: string): RentEntryErrors {
  const errors = validateRentEntryDraft({ ...input, paidDate: input.paidDate ?? '' }, today)

  if (input.tenantId.trim() === '') {
    errors.tenantId = 'The entry has no tenant.'
  }

  if (input.totalPaid === 0 && input.paidDate !== null) {
    errors.paidDate = 'Paid date must be empty when nothing was paid.'
  }

  return errors
}

export function parseRentEntryDraft(
  tenantId: string,
  draft: RentEntryDraft,
  today: string,
): ParsedRentEntry {
  const errors = validateRentEntryDraft(draft, today)
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  // Validation guarantees these are finite numbers.
  const totalPaid = draft.totalPaid as number

  return {
    ok: true,
    input: {
      tenantId,
      billingMonth: draft.billingMonth,
      rentAmount: draft.rentAmount as number,
      electricityUnits: draft.electricityUnits as number,
      electricityRate: draft.electricityRate,
      waterAmount: draft.waterAmount as number,
      totalPaid,
      paidDate: totalPaid > 0 ? draft.paidDate : null,
      notes: draft.notes.trim(),
    },
  }
}
