import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Payment } from '@/types/payment'
import type { RentEntry } from '@/types/rentEntry'
import {
  loadRentLedger,
  RENT_LEDGER_STORAGE_KEY,
  saveRentLedger,
  UNKNOWN_FORMAT_MESSAGE,
} from '@/utils/rentLedgerStorage'

// Total due ₹15,750
const entry: RentEntry = {
  id: 'entry-001',
  tenantId: 'tenant-001',
  billingMonth: '2026-10',
  rentAmount: 15000,
  electricityUnits: 75,
  electricityRate: 6,
  waterAmount: 300,
  notes: '',
  createdAt: '2026-10-03T06:00:00.000Z',
}

const payment: Payment = {
  id: 'payment-001',
  entryId: 'entry-001',
  amount: 10000,
  paidDate: '2026-10-03',
  notes: 'Initial payment',
  createdAt: '2026-10-03T06:00:00.000Z',
}

function store(value: unknown) {
  localStorage.setItem(RENT_LEDGER_STORAGE_KEY, JSON.stringify(value))
}

function storeLedger(entries: unknown[], payments: unknown[] = []) {
  store({ version: 2, entries, payments })
}

function failWrites() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('saveRentLedger', () => {
  it('writes entries and payments in one versioned wrapper under the storage key', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    saveRentLedger({ entries: [entry], payments: [payment] })

    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)!)).toEqual({
      version: 2,
      entries: [entry],
      payments: [payment],
    })
  })

  it('does not store calculated totals', () => {
    saveRentLedger({ entries: [entry], payments: [payment] })

    const raw = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)!
    expect(raw).not.toContain('totalDue')
    expect(raw).not.toContain('totalPaid')
    expect(raw).not.toContain('outstanding')
    expect(raw).not.toContain('status')
  })

  it('lets a failed write throw', () => {
    failWrites()

    expect(() => saveRentLedger({ entries: [entry], payments: [] })).toThrow('Quota exceeded')
  })
})

describe('loadRentLedger', () => {
  it('returns an empty ledger when nothing is stored', () => {
    expect(loadRentLedger()).toEqual({ entries: [], payments: [] })
  })

  it('round-trips a saved ledger unchanged', () => {
    const unpaid = { ...entry, id: 'entry-002', billingMonth: '2026-09' }
    const second = { ...payment, id: 'payment-002', amount: 5750, paidDate: '2026-10-10' }
    saveRentLedger({ entries: [entry, unpaid], payments: [payment, second] })

    expect(loadRentLedger()).toEqual({ entries: [entry, unpaid], payments: [payment, second] })
  })

  it('drops unknown extra fields', () => {
    storeLedger([{ ...entry, totalDue: 15750 }], [{ ...payment, receipt: 'R-1' }])

    expect(loadRentLedger()).toEqual({ entries: [entry], payments: [payment] })
  })

  it('does not reject a paid date after today (the device clock may have changed)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 1))
    storeLedger([entry], [payment])

    expect(loadRentLedger().payments).toEqual([payment])
  })

  it('accepts payments that add up exactly to the total due', () => {
    storeLedger([entry], [payment, { ...payment, id: 'payment-002', amount: 5750 }])

    expect(loadRentLedger().payments).toHaveLength(2)
  })

  describe('migrating version 1 data', () => {
    const legacyPaid = { ...entry, totalPaid: 10000, paidDate: '2026-10-03' }
    const legacyUnpaid = {
      ...entry,
      id: 'entry-002',
      billingMonth: '2026-09',
      totalPaid: 0,
      paidDate: null,
    }

    function storeVersion1(...entries: unknown[]) {
      store({ version: 1, entries })
    }

    it('turns a paid amount into one payment and keeps unpaid bills without payments', () => {
      storeVersion1(legacyPaid, legacyUnpaid)

      expect(loadRentLedger()).toEqual({
        entries: [entry, { ...entry, id: 'entry-002', billingMonth: '2026-09' }],
        payments: [
          {
            id: 'legacy-payment:entry-001',
            entryId: 'entry-001',
            amount: 10000,
            paidDate: '2026-10-03',
            notes: '',
            createdAt: entry.createdAt,
          },
        ],
      })
    })

    it('persists the migrated ledger as version 2 under the same key', () => {
      storeVersion1(legacyPaid)

      const ledger = loadRentLedger()

      expect(JSON.parse(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)!)).toEqual({
        version: 2,
        ...ledger,
      })
      expect(loadRentLedger()).toEqual(ledger)
    })

    it('gives the same payment id every time', () => {
      storeVersion1(legacyPaid)
      const first = loadRentLedger()
      localStorage.clear()
      storeVersion1(legacyPaid)

      expect(loadRentLedger()).toEqual(first)
    })

    // Version 1's form had no decimal limit (step="any"), so this is valid stored data.
    it('rounds a paid amount with more than two decimals to whole paise', () => {
      storeVersion1({ ...legacyPaid, totalPaid: 5000.333 })

      expect(loadRentLedger().payments[0]!.amount).toBe(5000.33)
    })

    it('keeps a bill paid in full when its amount rounds up to the total due', () => {
      storeVersion1({ ...legacyPaid, totalPaid: 15749.996 })

      expect(loadRentLedger().payments[0]!.amount).toBe(15750)
    })

    it('records no payment for an amount under half a paisa', () => {
      storeVersion1({ ...legacyPaid, totalPaid: 0.004 })

      expect(loadRentLedger()).toEqual({ entries: [entry], payments: [] })
    })

    it('throws, and keeps the original data, when the write fails', () => {
      storeVersion1(legacyPaid)
      const original = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)
      failWrites()

      expect(() => loadRentLedger()).toThrow('Quota exceeded')
      expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(original)
    })

    it.each([
      ['a payment without a paid date', { ...legacyPaid, paidDate: null }],
      ['a paid date with no payment', { ...legacyPaid, totalPaid: 0 }],
      ['an invalid paid date', { ...legacyPaid, paidDate: '2026-02-30' }],
      ['a negative payment', { ...legacyPaid, totalPaid: -1 }],
      ['a missing total paid', { ...legacyPaid, totalPaid: undefined }],
      ['a zero rent', { ...legacyPaid, rentAmount: 0 }],
    ])('rejects, without changing anything, an entry with %s', (_, value) => {
      storeVersion1(value)
      const original = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)

      expect(() => loadRentLedger()).toThrow(/Stored rent entry 0 is invalid/)
      expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(original)
    })

    it('rejects an overpayment', () => {
      storeVersion1({ ...legacyPaid, totalPaid: 99999 })

      expect(() => loadRentLedger()).toThrow('Stored payments exceed the total due of their entry.')
    })

    it('rejects duplicates', () => {
      storeVersion1(legacyPaid, { ...legacyPaid, billingMonth: '2026-09' })

      expect(() => loadRentLedger()).toThrow('Stored rent entries contain duplicates.')
    })

    it('rejects a version 1 wrapper without entries', () => {
      store({ version: 1 })

      expect(() => loadRentLedger()).toThrow(UNKNOWN_FORMAT_MESSAGE)
    })
  })

  describe('rejects corrupt data', () => {
    it('that is not JSON', () => {
      localStorage.setItem(RENT_LEDGER_STORAGE_KEY, '{not json')

      expect(() => loadRentLedger()).toThrow(SyntaxError)
    })

    it.each([
      ['an array', [entry]],
      ['null', null],
      ['a missing version', { entries: [entry], payments: [] }],
      ['an unknown version', { version: 3, entries: [entry], payments: [] }],
      ['missing entries', { version: 2, payments: [] }],
      ['missing payments', { version: 2, entries: [entry] }],
      ['payments that are not an array', { version: 2, entries: [], payments: {} }],
    ])('with %s as the wrapper', (_, value) => {
      store(value)

      expect(() => loadRentLedger()).toThrow(UNKNOWN_FORMAT_MESSAGE)
    })

    it.each([
      ['not an object', 'entry'],
      ['an empty id', { ...entry, id: '' }],
      ['an empty tenant id', { ...entry, tenantId: '' }],
      ['an invalid billing month', { ...entry, billingMonth: '2026-13' }],
      ['a string amount', { ...entry, rentAmount: '15000' }],
      ['a zero rent', { ...entry, rentAmount: 0 }],
      ['negative units', { ...entry, electricityUnits: -1 }],
      ['a missing water amount', { ...entry, waterAmount: undefined }],
      ['non-string notes', { ...entry, notes: 5 }],
      ['notes over 500 characters', { ...entry, notes: 'a'.repeat(501) }],
      ['an invalid timestamp', { ...entry, createdAt: 'yesterday' }],
    ])('with an entry that has %s', (_, value) => {
      storeLedger([value])

      expect(() => loadRentLedger()).toThrow(/Stored rent entry 0 is invalid/)
    })

    it.each([
      ['not an object', 'payment'],
      ['an empty id', { ...payment, id: '' }],
      ['no entry id', { ...payment, entryId: undefined }],
      ['a string amount', { ...payment, amount: '10000' }],
      ['a zero amount', { ...payment, amount: 0 }],
      ['a negative amount', { ...payment, amount: -1 }],
      ['three decimal places', { ...payment, amount: 10.005 }],
      ['an invalid paid date', { ...payment, paidDate: '2026-02-30' }],
      ['a missing paid date', { ...payment, paidDate: null }],
      ['notes over 500 characters', { ...payment, notes: 'a'.repeat(501) }],
      ['an invalid timestamp', { ...payment, createdAt: 'yesterday' }],
    ])('with a payment that has %s', (_, value) => {
      storeLedger([entry], [value])

      expect(() => loadRentLedger()).toThrow(/Stored payment 0 is invalid/)
    })

    it('with repeated entry ids', () => {
      storeLedger([entry, { ...entry, billingMonth: '2026-09' }])

      expect(() => loadRentLedger()).toThrow('Stored rent entries contain duplicates.')
    })

    it('with repeated tenant and month', () => {
      storeLedger([entry, { ...entry, id: 'entry-002' }])

      expect(() => loadRentLedger()).toThrow('Stored rent entries contain duplicates.')
    })

    it('with repeated payment ids', () => {
      storeLedger([entry], [payment, { ...payment, amount: 1 }])

      expect(() => loadRentLedger()).toThrow('Stored payments contain duplicates.')
    })

    it('with a payment for an entry that does not exist', () => {
      storeLedger([entry], [{ ...payment, entryId: 'entry-999' }])

      expect(() => loadRentLedger()).toThrow('A stored payment belongs to no entry.')
    })

    it('with payments adding up to more than the total due', () => {
      storeLedger([entry], [payment, { ...payment, id: 'payment-002', amount: 5750.01 }])

      expect(() => loadRentLedger()).toThrow('Stored payments exceed the total due of their entry.')
    })

    it('without changing what is stored', () => {
      storeLedger([entry], [{ ...payment, entryId: 'entry-999' }])
      const original = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)

      expect(() => loadRentLedger()).toThrow()
      expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(original)
    })
  })
})
