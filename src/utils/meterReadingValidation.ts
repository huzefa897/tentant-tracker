// Meter reading rules, used by the forms for inline errors. The backend checks them again,
// against every reading of the tenancy: these only catch what the form already knows.

import type { MeterPoint } from '@/types/meterReading'
import { formatDateValue, isValidDateValue } from '@/utils/date'
import { hasAtMostDecimals } from '@/utils/money'
import { MAX_UNITS, type NumberInputValue, toAmount } from '@/utils/rentEntryValidation'

export const REASON_MAX_LENGTH = 500

// A reading as typed.
export interface MeterReadingDraft {
  reading: NumberInputValue
  readOn: string // YYYY-MM-DD, or '' while empty
}

export type MeterReadingErrors = Partial<Record<keyof MeterReadingDraft, string>>

export interface MeterReadingContext {
  // The reading it must follow (the last billed one on a bill, the baseline otherwise): not
  // below its value, and after its day (or on it, for the baseline: id null or left out).
  after: MeterPoint | null
  today: string // YYYY-MM-DD
}

export function validateMeterReadingDraft(
  draft: MeterReadingDraft,
  { after, today }: MeterReadingContext,
): MeterReadingErrors {
  const errors: MeterReadingErrors = {}
  const reading = toAmount(draft.reading)
  if (reading === null) {
    errors.reading = 'Enter the meter reading.'
  } else if (reading < 0) {
    errors.reading = "A meter reading can't be negative."
  } else if (!hasAtMostDecimals(reading, 3)) {
    errors.reading = 'A meter reading can have at most 3 decimals.'
  } else if (reading > MAX_UNITS) {
    errors.reading = `A meter reading must be at most ${MAX_UNITS.toLocaleString('en-IN')}.`
  } else if (after && reading < after.reading) {
    errors.reading = `The reading can't be below ${after.reading.toLocaleString('en-IN')}.`
  }

  if (!isValidDateValue(draft.readOn)) {
    errors.readOn = 'Enter the day the meter was read.'
  } else if (draft.readOn > today) {
    errors.readOn = "The reading can't be dated in the future."
  } else if (after && !after.id && draft.readOn < after.readOn) {
    errors.readOn = `The reading can't be dated before meter tracking started on ${formatDateValue(after.readOn)}.`
  } else if (after?.id && draft.readOn <= after.readOn) {
    errors.readOn = `The reading must be after ${formatDateValue(after.readOn)}.`
  }
  return errors
}

// Units between two readings, in thousandths so 2876.5 − 2563.25 is exact; null until both are
// valid and in order.
export function unitsBetween(opening: MeterPoint | null, closing: NumberInputValue): number | null {
  const value = toAmount(closing)
  if (opening === null || value === null || value < opening.reading) return null
  return (Math.round(value * 1000) - Math.round(opening.reading * 1000)) / 1000
}

export function validateReason(reason: string, what: string): string | undefined {
  const trimmed = reason.trim()
  if (trimmed === '') return `Say why this ${what}.`
  if (trimmed.length > REASON_MAX_LENGTH) {
    return `The reason must be ${REASON_MAX_LENGTH} characters or fewer.`
  }
  return undefined
}
