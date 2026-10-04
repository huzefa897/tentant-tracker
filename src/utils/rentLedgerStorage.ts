// Prototype persistence: one browser, can be cleared, doesn't sync. Replaced by a backend later.

import type { Payment } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import type { RentEntry } from '@/types/rentEntry'
import type { RentLedger, RentLedgerStorage } from '@/types/rentLedger'
import { isValidDateValue, isValidIsoTimestamp, isValidMonthValue } from '@/utils/date'
import { fromPaise, hasAtMostTwoDecimals, toPaise } from '@/utils/money'
import { validatePaymentInput } from '@/utils/paymentValidation'
import { calculateTotalDue } from '@/utils/rentCalculations'
import { NOTES_MAX_LENGTH, validateRentEntryInput } from '@/utils/rentEntryValidation'

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

// Entry shape checks shared by every version: JSON.parse proves nothing about types.
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

// A finite amount of money in whole paise, at least `min`.
function isMoney(value: unknown, min = 0): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    hasAtMostTwoDecimals(value)
  )
}

function toReceipt(value: unknown, index: number): PaymentReceipt {
  const fail: Fail = (reason) => {
    throw new Error(`Stored receipt ${index} is invalid: ${reason}`)
  }

  if (!isRecord(value)) return fail('not an object')
  if (!isNonEmptyString(value.id)) return fail('id')
  if (!isNonEmptyString(value.reference)) return fail('reference')
  if (!isNonEmptyString(value.paymentId)) return fail('paymentId')
  if (!isNonEmptyString(value.entryId)) return fail('entryId')
  if (!isValidTimestamp(value.issuedAt)) return fail('issuedAt')

  const { issuer, tenant, charges } = value
  if (!isRecord(issuer)) return fail('issuer')
  if (!isNonEmptyString(issuer.name)) return fail('issuer.name')
  if (typeof issuer.managerName !== 'string') return fail('issuer.managerName')
  if (!isNonEmptyString(issuer.address)) return fail('issuer.address')
  if (typeof issuer.contactNumber !== 'string') return fail('issuer.contactNumber')
  if (typeof issuer.email !== 'string') return fail('issuer.email')

  if (!isRecord(tenant)) return fail('tenant')
  if (!isNonEmptyString(tenant.name)) return fail('tenant.name')
  if (!isNonEmptyString(tenant.flatNumber)) return fail('tenant.flatNumber')
  if (typeof tenant.mobileNumber !== 'string') return fail('tenant.mobileNumber')
  if (!isMoney(tenant.depositAmount)) return fail('tenant.depositAmount')

  if (typeof value.billingMonth !== 'string' || !isValidMonthValue(value.billingMonth)) {
    return fail('billingMonth')
  }

  const dueDay = value.rentDueDay
  if (typeof dueDay !== 'number' || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return fail('rentDueDay')
  }

  if (!isRecord(charges)) return fail('charges')
  const chargeKeys = ['rentAmount', 'electricityUnits', 'electricityRate', 'waterAmount'] as const
  for (const key of chargeKeys) {
    const charge = charges[key]
    if (typeof charge !== 'number' || !Number.isFinite(charge) || charge < 0) {
      return fail(`charges.${key}`)
    }
  }

  const figures = ['totalDue', 'totalPaid', 'outstanding', 'previousMonthOutstanding'] as const
  for (const key of figures) {
    if (!isMoney(value[key])) return fail(key)
  }

  if (!isMoney(value.paymentAmount) || value.paymentAmount === 0) return fail('paymentAmount')

  if (typeof value.paidDate !== 'string' || !isValidDateValue(value.paidDate)) {
    return fail('paidDate')
  }
  if (typeof value.paymentNotes !== 'string' || value.paymentNotes.length > NOTES_MAX_LENGTH) {
    return fail('paymentNotes')
  }

  // The snapshot itself, so it's kept exactly as issued. Only known fields are copied.
  return {
    id: value.id,
    reference: value.reference,
    paymentId: value.paymentId,
    entryId: value.entryId,
    issuedAt: value.issuedAt,
    issuer: {
      name: issuer.name,
      managerName: issuer.managerName,
      address: issuer.address,
      contactNumber: issuer.contactNumber,
      email: issuer.email,
    },
    tenant: {
      name: tenant.name,
      flatNumber: tenant.flatNumber,
      mobileNumber: tenant.mobileNumber,
      depositAmount: tenant.depositAmount,
    },
    billingMonth: value.billingMonth,
    rentDueDay: dueDay,
    charges: {
      rentAmount: charges.rentAmount as number,
      electricityUnits: charges.electricityUnits as number,
      electricityRate: charges.electricityRate as number,
      waterAmount: charges.waterAmount as number,
    },
    totalDue: value.totalDue as number,
    totalPaid: value.totalPaid as number,
    outstanding: value.outstanding as number,
    previousMonthOutstanding: value.previousMonthOutstanding as number,
    paymentAmount: value.paymentAmount,
    paidDate: value.paidDate,
    paymentNotes: value.paymentNotes,
  }
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

  const paymentsById = new Map(ledger.payments.map((payment) => [payment.id, payment]))
  const entriesById = new Map(ledger.entries.map((entry) => [entry.id, entry]))
  const receiptIds = new Set<string>()
  const references = new Set<string>()
  const receiptedPayments = new Set<string>()

  // The tenant and issuer snapshots are not compared with current details: they're historical.
  for (const receipt of ledger.receipts) {
    if (
      receiptIds.has(receipt.id) ||
      references.has(receipt.reference) ||
      receiptedPayments.has(receipt.paymentId)
    ) {
      throw new Error('Stored receipts contain duplicates.')
    }
    receiptIds.add(receipt.id)
    references.add(receipt.reference)
    receiptedPayments.add(receipt.paymentId)

    // Every payment belongs to an existing entry (checked above), so this covers the entry too.
    const payment = paymentsById.get(receipt.paymentId)
    if (!payment || payment.entryId !== receipt.entryId) {
      throw new Error('A stored receipt belongs to no payment.')
    }

    if (
      toPaise(receipt.paymentAmount) !== toPaise(payment.amount) ||
      receipt.paidDate !== payment.paidDate
    ) {
      throw new Error('A stored receipt does not match its payment.')
    }

    // Bills can't be edited, so the copied charges must still match. The figures must add up;
    // they're not compared with the bill's payments now, as later payments are expected.
    const entry = entriesById.get(receipt.entryId)!
    const { charges } = receipt
    const totalDue = toPaise(calculateTotalDue(entry))
    const paid = toPaise(receipt.totalPaid)
    if (
      charges.rentAmount !== entry.rentAmount ||
      charges.electricityUnits !== entry.electricityUnits ||
      charges.electricityRate !== entry.electricityRate ||
      charges.waterAmount !== entry.waterAmount ||
      receipt.billingMonth !== entry.billingMonth ||
      toPaise(receipt.totalDue) !== totalDue ||
      paid < toPaise(receipt.paymentAmount) ||
      paid > totalDue ||
      toPaise(receipt.outstanding) !== totalDue - paid
    ) {
      throw new Error('A stored receipt does not match its bill.')
    }
  }
}

function readVersion3(parsed: Record<string, unknown>): RentLedger {
  if (
    !Array.isArray(parsed.entries) ||
    !Array.isArray(parsed.payments) ||
    !Array.isArray(parsed.receipts)
  ) {
    throw new Error(UNKNOWN_FORMAT_MESSAGE)
  }

  const ledger: RentLedger = {
    entries: parsed.entries.map(toRentEntry),
    payments: parsed.payments.map(toPayment),
    receipts: parsed.receipts.map(toReceipt),
  }

  validateLedgerRelationships(ledger)

  return ledger
}

// Version 2 had no receipts. None are issued during migration: the owners issue them
// deliberately, after checking the issuer details.
function migrateVersion2(parsed: Record<string, unknown>): RentLedger {
  if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.payments)) {
    throw new Error(UNKNOWN_FORMAT_MESSAGE)
  }

  return readVersion3({ entries: parsed.entries, payments: parsed.payments, receipts: [] })
}

// Version 1 kept one payment on the entry itself (`totalPaid`, `paidDate`). Each becomes a
// payment record; the bill and its balance are unchanged.
function migrateVersion1(parsed: Record<string, unknown>): RentLedger {
  if (!Array.isArray(parsed.entries)) throw new Error(UNKNOWN_FORMAT_MESSAGE)

  const ledger: Omit<RentLedger, 'receipts'> = { entries: [], payments: [] }

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

  // Then on as version 2 data: the migrated ledger must pass the same checks as one saved by
  // this version.
  return migrateVersion2({ entries: ledger.entries, payments: ledger.payments })
}

const emptyLedger = (): RentLedger => ({ entries: [], payments: [], receipts: [] })

// Throws if stored data is unreadable or invalid. Callers must not treat that as "no
// entries": saving over it would destroy the user's data.
// Older versions are migrated, validated and written back before they're returned; if migration
// or that write fails, this throws and the original data stays as it was.
export function loadRentLedger(): RentLedger {
  const raw = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)
  if (raw === null) return emptyLedger()

  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) throw new Error(UNKNOWN_FORMAT_MESSAGE)

  if (parsed.version === 3) return readVersion3(parsed)

  let ledger: RentLedger
  if (parsed.version === 2) ledger = migrateVersion2(parsed)
  else if (parsed.version === 1) ledger = migrateVersion1(parsed)
  else throw new Error(UNKNOWN_FORMAT_MESSAGE)

  saveRentLedger(ledger)
  return ledger
}

// One setItem for the whole ledger, so a bill and its payment (or a payment and its receipt)
// are saved together or not at all.
// Can throw (quota exceeded, storage disabled); the store turns that into user feedback.
export function saveRentLedger(ledger: RentLedger): void {
  const payload: RentLedgerStorage = {
    version: 3,
    entries: ledger.entries,
    payments: ledger.payments,
    receipts: ledger.receipts,
  }

  localStorage.setItem(RENT_LEDGER_STORAGE_KEY, JSON.stringify(payload))
}
