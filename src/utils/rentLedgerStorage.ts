// Prototype persistence: one browser, can be cleared, doesn't sync. Replaced by a backend later.

import type { Payment } from '@/types/payment'
import type { RentEntry } from '@/types/rentEntry'
import type { RentLedger, RentLedgerStorage } from '@/types/rentLedger'
import { isValidDateValue, isValidIsoTimestamp } from '@/utils/date'
import { fromPaise, toPaise } from '@/utils/money'
import { validatePaymentInput } from '@/utils/paymentValidation'
import { calculateTotalDue } from '@/utils/rentCalculations'
import { validateRentEntryInput } from '@/utils/rentEntryValidation'

// Kept from version 1 despite its suffix, so data never splits across two keys. The wrapper's
// `version` decides how it's read.
export const RENT_LEDGER_STORAGE_KEY = 'rent-tracker:rent-entries:v1'

export const UNKNOWN_FORMAT_MESSAGE = 'Stored rent entries have an unknown format.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && isValidIsoTimestamp(value)
}

type Fail = (reason: string) => never

// Shape checks shared by both versions: JSON.parse proves nothing about types.
function readEntryFields(value: unknown, fail: Fail): RentEntry {
  if (!isRecord(value)) return fail('not an object')
  if (!isNonEmptyString(value.id)) return fail('id')
  if (!isNonEmptyString(value.tenantId)) return fail('tenantId')
  if (typeof value.billingMonth !== 'string') return fail('billingMonth')

  const numbers = ['rentAmount', 'electricityUnits', 'electricityRate', 'waterAmount'] as const
  for (const key of numbers) {
    if (typeof value[key] !== 'number') return fail(key)
  }

  if (typeof value.notes !== 'string') return fail('notes')
  if (!isValidTimestamp(value.createdAt)) return fail('createdAt')

  // Copy only known fields so unexpected extra data never reaches the app.
  return {
    id: value.id,
    tenantId: value.tenantId,
    billingMonth: value.billingMonth,
    rentAmount: value.rentAmount as number,
    electricityUnits: value.electricityUnits as number,
    electricityRate: value.electricityRate as number,
    waterAmount: value.waterAmount as number,
    notes: value.notes,
    createdAt: value.createdAt,
  }
}

function toRentEntry(value: unknown, index: number): RentEntry {
  const fail: Fail = (reason) => {
    throw new Error(`Stored rent entry ${index} is invalid: ${reason}`)
  }

  const entry = readEntryFields(value, fail)

  const errors = Object.keys(validateRentEntryInput(entry))
  if (errors.length > 0) fail(errors.join(', '))

  return entry
}

function toPayment(value: unknown, index: number): Payment {
  const fail: Fail = (reason) => {
    throw new Error(`Stored payment ${index} is invalid: ${reason}`)
  }

  if (!isRecord(value)) return fail('not an object')
  if (!isNonEmptyString(value.id)) return fail('id')
  if (!isNonEmptyString(value.entryId)) return fail('entryId')
  if (typeof value.amount !== 'number') return fail('amount')
  if (typeof value.paidDate !== 'string') return fail('paidDate')
  if (typeof value.notes !== 'string') return fail('notes')
  if (!isValidTimestamp(value.createdAt)) return fail('createdAt')

  const payment: Payment = {
    id: value.id,
    entryId: value.entryId,
    amount: value.amount,
    paidDate: value.paidDate,
    notes: value.notes,
    createdAt: value.createdAt,
  }

  // No `today`: a paid date after today isn't rejected, as the device clock may have changed.
  const errors = Object.keys(validatePaymentInput(payment))
  if (errors.length > 0) fail(errors.join(', '))

  return payment
}

// Rules across records, which no single entry or payment can check. Throws on the first problem.
export function validateLedgerRelationships(ledger: RentLedger): void {
  const entryIds = new Set<string>()
  const tenantMonths = new Set<string>()
  const outstandingPaise = new Map<string, number>()

  for (const entry of ledger.entries) {
    const tenantMonth = `${entry.tenantId}|${entry.billingMonth}`

    if (entryIds.has(entry.id) || tenantMonths.has(tenantMonth)) {
      throw new Error('Stored rent entries contain duplicates.')
    }

    entryIds.add(entry.id)
    tenantMonths.add(tenantMonth)
    outstandingPaise.set(entry.id, toPaise(calculateTotalDue(entry)))
  }

  const paymentIds = new Set<string>()

  for (const payment of ledger.payments) {
    if (paymentIds.has(payment.id)) {
      throw new Error('Stored payments contain duplicates.')
    }
    paymentIds.add(payment.id)

    const outstanding = outstandingPaise.get(payment.entryId)
    if (outstanding === undefined) {
      throw new Error('A stored payment belongs to no entry.')
    }

    const remaining = outstanding - toPaise(payment.amount)
    if (remaining < 0) {
      throw new Error('Stored payments exceed the total due of their entry.')
    }
    outstandingPaise.set(payment.entryId, remaining)
  }
}

function readVersion2(parsed: Record<string, unknown>): RentLedger {
  if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.payments)) {
    throw new Error(UNKNOWN_FORMAT_MESSAGE)
  }

  const ledger: RentLedger = {
    entries: parsed.entries.map(toRentEntry),
    payments: parsed.payments.map(toPayment),
  }

  validateLedgerRelationships(ledger)

  return ledger
}

// Version 1 kept one payment on the entry itself (`totalPaid`, `paidDate`). Each becomes a
// payment record; the bill and its balance are unchanged.
function migrateVersion1(parsed: Record<string, unknown>): RentLedger {
  if (!Array.isArray(parsed.entries)) throw new Error(UNKNOWN_FORMAT_MESSAGE)

  const ledger: RentLedger = { entries: [], payments: [] }

  parsed.entries.forEach((value, index) => {
    const fail: Fail = (reason) => {
      throw new Error(`Stored rent entry ${index} is invalid: ${reason}`)
    }

    const entry = readEntryFields(value, fail)
    const { totalPaid, paidDate } = value as Record<string, unknown>

    if (typeof totalPaid !== 'number' || !Number.isFinite(totalPaid) || totalPaid < 0) {
      return fail('totalPaid')
    }

    if (totalPaid === 0) {
      if (paidDate !== null) fail('paidDate')
    } else {
      if (typeof paidDate !== 'string' || !isValidDateValue(paidDate)) fail('paidDate')

      // Version 1 allowed any number of decimals; payments are whole paise. Rounding can't
      // push a payment over its bill: version 1 kept it within the total due, which is
      // itself whole paise.
      const amount = fromPaise(toPaise(totalPaid))

      // Under half a paisa rounds to nothing, which leaves no payment to keep.
      if (amount > 0) {
        ledger.payments.push({
          // Deterministic, so migrating the same data twice gives the same ids.
          id: `legacy-payment:${entry.id}`,
          entryId: entry.id,
          amount,
          paidDate: paidDate as string,
          notes: '',
          // When it was recorded; when it was received stays `paidDate`.
          createdAt: entry.createdAt,
        })
      }
    }

    ledger.entries.push(entry)
  })

  // The migrated ledger must pass the same checks as one saved by this version.
  return readVersion2({ entries: ledger.entries, payments: ledger.payments })
}

const emptyLedger = (): RentLedger => ({ entries: [], payments: [] })

// Throws if stored data is unreadable or invalid. Callers must not treat that as "no
// entries": saving over it would destroy the user's data.
// Version 1 data is migrated and written back before it's returned; if migration or that write
// fails, this throws and the original data stays as it was.
export function loadRentLedger(): RentLedger {
  const raw = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)
  if (raw === null) return emptyLedger()

  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) throw new Error(UNKNOWN_FORMAT_MESSAGE)

  if (parsed.version === 2) return readVersion2(parsed)

  if (parsed.version === 1) {
    const ledger = migrateVersion1(parsed)
    saveRentLedger(ledger)
    return ledger
  }

  throw new Error(UNKNOWN_FORMAT_MESSAGE)
}

// One setItem for the whole ledger, so a bill and its payment are saved together or not at all.
// Can throw (quota exceeded, storage disabled); the store turns that into user feedback.
export function saveRentLedger(ledger: RentLedger): void {
  const payload: RentLedgerStorage = {
    version: 2,
    entries: ledger.entries,
    payments: ledger.payments,
  }

  localStorage.setItem(RENT_LEDGER_STORAGE_KEY, JSON.stringify(payload))
}
