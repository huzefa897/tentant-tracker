// How a bill's electricity was charged. manual: units typed in (every bill from before meter
// readings, and tenancies whose meter isn't set up). meter: the units between two readings.
// not_charged: left off this bill; the readings wait for a later meter bill.
export type ElectricityMode = 'manual' | 'meter' | 'not_charged'

// A reading on the meter: the units shown and the day it was read. id is the recorded reading's,
// null for the tenancy's baseline (and left out on receipts, which save the figures only).
export interface MeterPoint {
  id?: string | null
  reading: number
  readOn: string // YYYY-MM-DD
}

// A receipt's opening reading: no date when it's where tracking started (the baseline has a
// recorded time, not a day the meter was read).
export interface ReceiptMeterPoint {
  reading: number
  readOn: string | null // YYYY-MM-DD
}

export type MeterReadingStatus = 'active' | 'void'

// One reading of a tenancy's meter, from the backend. Never edited: a wrong one is voided, or
// voided and replaced.
export interface MeterReading {
  id: string
  reading: number
  readOn: string // YYYY-MM-DD
  // The units entered, when the reading was entered as units used since the latest reading
  // (the backend added them to it); null when the reading itself was entered.
  enteredUnits: number | null
  notes: string
  status: MeterReadingStatus
  // Units since the active reading before it (or the baseline); null for a void reading.
  consumption: number | null
  // The active bill that closes on it, if one does.
  billedBy: { id: string; billingMonth: string } | null
  createdAt: string
  voided: { at: string; byName: string; reason: string } | null
  replacesReadingId: string | null
  replacedByReadingId: string | null
}

// A tenancy's meter: where it starts, where the next meter bill starts, and every reading
// newest first. baseline and lastBilled are null while the meter isn't set up (in admin).
export interface TenantMeter {
  baseline: MeterPoint | null
  lastBilled: MeterPoint | null
  readings: MeterReading[]
}

// How a new reading is entered: what the meter says, or the units used since the latest
// reading, which the backend adds to it (so the tenant can give either, month to month).
export type ReadingEntryMode = 'reading' | 'units'
export type ReadingValue = { reading: number; units?: never } | { units: number; reading?: never }

// A new reading as a form submits it.
export type MeterReadingInput = ReadingValue & {
  readOn: string // YYYY-MM-DD
  notes: string
}

// A correction's replacement: always the reading itself (units would be added to the reading
// being corrected).
export interface MeterReadingCorrectionInput {
  reading: number
  readOn: string // YYYY-MM-DD
  notes: string
  reason: string
}
