import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Payment } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
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

// The receipt for `payment` (₹10,000 of entry's ₹15,750).
const receipt: PaymentReceipt = {
  id: 'receipt-001',
  reference: 'RCP-202-202610',
  paymentId: 'payment-001',
  entryId: 'entry-001',
  issuedAt: '2026-10-03T07:00:00.000Z',
  issuer: {
    name: 'Saleem Towers',
    managerName: 'Test Manager',
    address: '1 Example Road',
    contactNumber: '',
    email: '',
  },
  tenant: { name: 'Test Tenant', flatNumber: '202', mobileNumber: '', depositAmount: 50000 },
  billingMonth: '2026-10',
  rentDueDay: 1,
  charges: { rentAmount: 15000, electricityUnits: 75, electricityRate: 6, waterAmount: 300 },
  totalDue: 15750,
  totalPaid: 10000,
  outstanding: 5750,
  previousMonthOutstanding: 0,
  paymentAmount: 10000,
  paidDate: '2026-10-03',
  paymentNotes: 'Initial payment',
}

function store(value: unknown) {
  localStorage.setItem(RENT_LEDGER_STORAGE_KEY, JSON.stringify(value))
}

function storeLedger(entries: unknown[], payments: unknown[] = [], receipts: unknown[] = []) {
  store({ version: 3, entries, payments, receipts })
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
  it('writes entries, payments and receipts in one versioned wrapper under the storage key', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    saveRentLedger({ entries: [entry], payments: [payment], receipts: [receipt] })

    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)!)).toEqual({
      version: 3,
      entries: [entry],
      payments: [payment],
      receipts: [receipt],
    })
  })

  it('does not store calculated totals', () => {
    saveRentLedger({ entries: [entry], payments: [payment], receipts: [] })

    const raw = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)!
    expect(raw).not.toContain('totalDue')
    expect(raw).not.toContain('totalPaid')
    expect(raw).not.toContain('outstanding')
    expect(raw).not.toContain('status')
  })

  it('lets a failed write throw', () => {
    failWrites()

    expect(() => saveRentLedger({ entries: [entry], payments: [], receipts: [] })).toThrow(
      'Quota exceeded',
    )
  })
})

describe('loadRentLedger', () => {
  // Snapshots are historical: they're never compared with current tenant or issuer details.
  it('accepts a receipt whose tenant and issuer differ from current details', () => {
    const historical = {
      ...receipt,
      issuer: {
        name: 'Old Name',
        managerName: '',
        address: 'Old address',
        contactNumber: '+914012345678',
        email: 'old@example.com',
      },
      tenant: { name: 'Former Name', flatNumber: '999', mobileNumber: '', depositAmount: 1 },
      rentDueDay: 28,
      previousMonthOutstanding: 1234.5,
    }
    storeLedger([entry], [payment], [historical])

    expect(loadRentLedger().receipts).toEqual([historical])
  })

  it('returns an empty ledger when nothing is stored', () => {
    expect(loadRentLedger()).toEqual({ entries: [], payments: [], receipts: [] })
  })

  it('round-trips a saved ledger unchanged', () => {
    const unpaid = { ...entry, id: 'entry-002', billingMonth: '2026-09' }
    const second = { ...payment, id: 'payment-002', amount: 5750, paidDate: '2026-10-10' }
    const ledger = { entries: [entry, unpaid], payments: [payment, second], receipts: [receipt] }
    saveRentLedger(ledger)

    expect(loadRentLedger()).toEqual(ledger)
  })

  it('drops unknown extra fields', () => {
    storeLedger(
      [{ ...entry, totalDue: 15750 }],
      [{ ...payment, receipt: 'R-1' }],
      [
        {
          ...receipt,
          status: 'partially_paid',
          issuer: { ...receipt.issuer, logo: 'x' },
          tenant: { ...receipt.tenant, rentAmount: 15000 },
          charges: { ...receipt.charges, electricityAmount: 450 },
        },
      ],
    )

    expect(loadRentLedger()).toEqual({ entries: [entry], payments: [payment], receipts: [receipt] })
  })

  describe('migrating version 2 data', () => {
    const version2 = { version: 2, entries: [entry], payments: [payment] }

    it('keeps entries and payments and issues no receipts', () => {
      store(version2)

      expect(loadRentLedger()).toEqual({ entries: [entry], payments: [payment], receipts: [] })
    })

    it('persists the upgraded ledger as version 3 under the same key', () => {
      store(version2)

      const ledger = loadRentLedger()

      expect(JSON.parse(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)!)).toEqual({
        version: 3,
        ...ledger,
      })
    })

    it('throws, and keeps the original data, when the write fails', () => {
      store(version2)
      const original = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)
      failWrites()

      expect(() => loadRentLedger()).toThrow('Quota exceeded')
      expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(original)
    })

    it('rejects invalid version 2 data without writing', () => {
      store({ ...version2, payments: [{ ...payment, entryId: 'entry-999' }] })
      const original = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)

      expect(() => loadRentLedger()).toThrow('A stored payment belongs to no entry.')
      expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(original)
    })

    it.each([
      ['missing entries', { version: 2, payments: [] }],
      ['missing payments', { version: 2, entries: [entry] }],
    ])('rejects a version 2 wrapper with %s', (_, value) => {
      store(value)

      expect(() => loadRentLedger()).toThrow(UNKNOWN_FORMAT_MESSAGE)
    })
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
        receipts: [],
      })
    })

    it('persists the migrated ledger as version 3 under the same key', () => {
      storeVersion1(legacyPaid)

      const ledger = loadRentLedger()

      expect(JSON.parse(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)!)).toEqual({
        version: 3,
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

      expect(loadRentLedger()).toEqual({ entries: [entry], payments: [], receipts: [] })
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
      ['an unknown version', { version: 4, entries: [entry], payments: [], receipts: [] }],
      ['missing entries', { version: 3, payments: [], receipts: [] }],
      ['missing payments', { version: 3, entries: [entry], receipts: [] }],
      ['missing receipts', { version: 3, entries: [entry], payments: [] }],
      ['payments that are not an array', { version: 3, entries: [], payments: {}, receipts: [] }],
      ['receipts that are not an array', { version: 3, entries: [], payments: [], receipts: {} }],
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

    it.each([
      ['not an object', 'receipt'],
      ['an empty id', { ...receipt, id: '' }],
      ['an empty reference', { ...receipt, reference: '' }],
      ['no payment id', { ...receipt, paymentId: undefined }],
      ['no entry id', { ...receipt, entryId: '' }],
      ['an invalid issued time', { ...receipt, issuedAt: '2026-02-30T00:00:00.000Z' }],
      ['no issuer', { ...receipt, issuer: null }],
      ['an empty issuer name', { ...receipt, issuer: { ...receipt.issuer, name: ' ' } }],
      ['no issuer address', { ...receipt, issuer: { ...receipt.issuer, address: undefined } }],
      ['a numeric contact', { ...receipt, issuer: { ...receipt.issuer, contactNumber: 9 } }],
      ['no tenant', { ...receipt, tenant: 'Test Tenant' }],
      ['an empty tenant name', { ...receipt, tenant: { ...receipt.tenant, name: '' } }],
      ['no manager name', { ...receipt, issuer: { ...receipt.issuer, managerName: undefined } }],
      ['no email', { ...receipt, issuer: { ...receipt.issuer, email: null } }],
      ['no tenant mobile', { ...receipt, tenant: { ...receipt.tenant, mobileNumber: 1 } }],
      ['a negative deposit', { ...receipt, tenant: { ...receipt.tenant, depositAmount: -1 } }],
      ['a due day of 0', { ...receipt, rentDueDay: 0 }],
      ['a due day of 32', { ...receipt, rentDueDay: 32 }],
      ['a fractional due day', { ...receipt, rentDueDay: 1.5 }],
      ['no charges', { ...receipt, charges: undefined }],
      ['a string rent', { ...receipt, charges: { ...receipt.charges, rentAmount: '15000' } }],
      ['negative units', { ...receipt, charges: { ...receipt.charges, electricityUnits: -1 } }],
      ['no total due', { ...receipt, totalDue: undefined }],
      ['a negative outstanding', { ...receipt, outstanding: -1 }],
      ['three-decimal total paid', { ...receipt, totalPaid: 10000.001 }],
      ['no previous month figure', { ...receipt, previousMonthOutstanding: null }],
      ['no flat number', { ...receipt, tenant: { ...receipt.tenant, flatNumber: undefined } }],
      ['an invalid billing month', { ...receipt, billingMonth: '2026-13' }],
      ['a string amount', { ...receipt, paymentAmount: '10000' }],
      ['a zero amount', { ...receipt, paymentAmount: 0 }],
      ['three decimal places', { ...receipt, paymentAmount: 10.005 }],
      ['an invalid paid date', { ...receipt, paidDate: '2026-02-30' }],
      ['non-string notes', { ...receipt, paymentNotes: null }],
      ['notes over 500 characters', { ...receipt, paymentNotes: 'a'.repeat(501) }],
    ])('with a receipt that has %s', (_, value) => {
      storeLedger([entry], [payment], [value])

      expect(() => loadRentLedger()).toThrow(/Stored receipt 0 is invalid/)
    })

    it.each([
      ['repeated receipt ids', { ...receipt, paymentId: 'payment-002', reference: 'RCT-2' }],
      ['repeated references', { ...receipt, id: 'receipt-002', paymentId: 'payment-002' }],
      ['two receipts for one payment', { ...receipt, id: 'receipt-002', reference: 'RCT-2' }],
    ])('with %s', (_, second) => {
      const other = { ...payment, id: 'payment-002', amount: 5750 }
      storeLedger([entry], [payment, other], [receipt, { ...second, paymentAmount: 5750 }])

      expect(() => loadRentLedger()).toThrow('Stored receipts contain duplicates.')
    })

    it.each([
      ['a payment that does not exist', { ...receipt, paymentId: 'payment-999' }],
      ['another entry than its payment’s', { ...receipt, entryId: 'entry-002' }],
    ])('with a receipt for %s', (_, value) => {
      const other = { ...entry, id: 'entry-002', billingMonth: '2026-09' }
      storeLedger([entry, other], [payment], [value])

      expect(() => loadRentLedger()).toThrow('A stored receipt belongs to no payment.')
    })

    it.each([
      ['amount', { ...receipt, paymentAmount: 9999.99 }],
      ['paid date', { ...receipt, paidDate: '2026-10-02' }],
    ])('with a receipt whose %s differs from its payment', (_, value) => {
      storeLedger([entry], [payment], [value])

      expect(() => loadRentLedger()).toThrow('A stored receipt does not match its payment.')
    })

    it.each([
      ['charges', { ...receipt, charges: { ...receipt.charges, rentAmount: 14000 } }],
      ['billing month', { ...receipt, billingMonth: '2026-09' }],
      ['total due', { ...receipt, totalDue: 15000 }],
      ['outstanding', { ...receipt, outstanding: 5000 }],
      ['total paid, below the payment', { ...receipt, totalPaid: 5000, outstanding: 10750 }],
      ['total paid, above the bill', { ...receipt, totalPaid: 16000, outstanding: 0 }],
    ])('with a receipt whose %s does not fit its bill', (_, value) => {
      storeLedger([entry], [payment], [value])

      expect(() => loadRentLedger()).toThrow('A stored receipt does not match its bill.')
    })

    // Later payments are expected: the receipt shows the bill as it was after its own payment.
    it('accepts a receipt issued before a later payment against the same bill', () => {
      const later = { ...payment, id: 'payment-002', amount: 5750, paidDate: '2026-10-10' }
      storeLedger([entry], [payment, later], [receipt])

      expect(loadRentLedger().receipts).toEqual([receipt])
    })

    it('without changing what is stored', () => {
      storeLedger([entry], [{ ...payment, entryId: 'entry-999' }])
      const original = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)

      expect(() => loadRentLedger()).toThrow()
      expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(original)
    })
  })
})
