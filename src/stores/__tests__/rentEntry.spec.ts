import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DUPLICATE_PAYMENT_MESSAGE,
  LOAD_ERROR_MESSAGE,
  SAVE_ERROR_MESSAGE,
  useRentEntryStore,
} from '@/stores/rentEntry'
import type { PaymentInput } from '@/types/payment'
import type { NewRentEntrySubmission, RentEntryInput } from '@/types/rentEntry'
import { RENT_LEDGER_STORAGE_KEY, saveRentLedger } from '@/utils/rentLedgerStorage'

// Total due: 15000 + 75 × 6 + 300 = 15750
const input: RentEntryInput = {
  tenantId: 'tenant-001',
  billingMonth: '2026-09',
  rentAmount: 15000,
  electricityUnits: 75,
  electricityRate: 6,
  waterAmount: 300,
  notes: '',
}

const initialPayment = { amount: 10000, paidDate: '2026-10-01', notes: 'Initial payment' }

function submission(
  entry: Partial<RentEntryInput> = {},
  payment: NewRentEntrySubmission['initialPayment'] = initialPayment,
): NewRentEntrySubmission {
  return { entry: { ...input, ...entry }, initialPayment: payment }
}

// A fresh Pinia over the same localStorage is what a page refresh looks like.
function refresh() {
  setActivePinia(createPinia())
  const store = useRentEntryStore()
  store.initialize()
  return store
}

function stored() {
  return localStorage.getItem(RENT_LEDGER_STORAGE_KEY)
}

function failWrites() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  })
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-03T06:30:00.000Z'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useRentEntryStore', () => {
  describe('initialize', () => {
    it('starts empty and not loaded', () => {
      const store = useRentEntryStore()

      expect(store.entries).toEqual([])
      expect(store.payments).toEqual([])
      expect(store.initialized).toBe(false)
      expect(store.loadError).toBeNull()
    })

    it('loads an empty ledger when nothing is saved', () => {
      const store = useRentEntryStore()
      store.initialize()

      expect(store.initialized).toBe(true)
      expect(store.entries).toEqual([])
      expect(store.payments).toEqual([])
      expect(store.loadError).toBeNull()
    })

    it('leaves an already loaded store alone', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(submission())
      localStorage.clear()

      store.initialize()

      expect(store.entries).toHaveLength(1)
      expect(store.payments).toHaveLength(1)
    })

    it('reports corrupt data, keeps it and blocks saving', () => {
      localStorage.setItem(RENT_LEDGER_STORAGE_KEY, '{not json')
      const store = useRentEntryStore()

      store.initialize()

      expect(store.loadError).toBe(LOAD_ERROR_MESSAGE)
      expect(store.initialized).toBe(false)
      expect(() => store.addEntry(submission())).toThrow(
        'Saved entries must load successfully before adding an entry.',
      )
      expect(stored()).toBe('{not json')
    })

    it('reports a storage read failure', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError')
      })
      const store = useRentEntryStore()

      store.initialize()

      expect(store.loadError).toBe(LOAD_ERROR_MESSAGE)
    })

    it('can retry after a failure', () => {
      localStorage.setItem(RENT_LEDGER_STORAGE_KEY, '{not json')
      const store = useRentEntryStore()
      store.initialize()

      localStorage.removeItem(RENT_LEDGER_STORAGE_KEY)
      store.initialize()

      expect(store.loadError).toBeNull()
      expect(store.initialized).toBe(true)
    })
  })

  describe('migrating version 1 data', () => {
    const legacy = {
      ...input,
      id: 'entry-1',
      totalPaid: 10000,
      paidDate: '2026-10-03',
      createdAt: '2026-10-03T06:00:00.000Z',
    }
    const legacyJson = JSON.stringify({ version: 1, entries: [legacy] })

    it('turns the old payment into a payment record with an unchanged balance', () => {
      localStorage.setItem(RENT_LEDGER_STORAGE_KEY, legacyJson)
      const store = useRentEntryStore()

      store.initialize()

      expect(store.payments).toEqual([
        {
          id: 'legacy-payment:entry-1',
          entryId: 'entry-1',
          amount: 10000,
          paidDate: '2026-10-03',
          notes: '',
          createdAt: '2026-10-03T06:00:00.000Z',
        },
      ])
      expect(store.getTotalPaid('entry-1')).toBe(10000)
      expect(JSON.parse(stored()!).version).toBe(2)
    })

    it('shows a load error and keeps the original data when the write fails', () => {
      localStorage.setItem(RENT_LEDGER_STORAGE_KEY, legacyJson)
      failWrites()
      const store = useRentEntryStore()

      store.initialize()

      expect(store.loadError).toBe(LOAD_ERROR_MESSAGE)
      expect(store.entries).toEqual([])
      expect(stored()).toBe(legacyJson)
    })
  })

  describe('addEntry', () => {
    it('refuses to save before entries are loaded', () => {
      expect(() => useRentEntryStore().addEntry(submission())).toThrow(
        'Saved entries must load successfully before adding an entry.',
      )
      expect(stored()).toBeNull()
    })

    it('saves the bill and its initial payment together', () => {
      const store = useRentEntryStore()
      store.initialize()

      const entry = store.addEntry(submission())

      expect(entry).toEqual({
        ...input,
        id: expect.any(String),
        createdAt: '2026-10-03T06:30:00.000Z',
      })
      expect(store.entries).toEqual([entry])
      expect(store.payments).toEqual([
        {
          ...initialPayment,
          id: expect.any(String),
          entryId: entry.id,
          createdAt: '2026-10-03T06:30:00.000Z',
        },
      ])
      expect(JSON.parse(stored()!)).toEqual({
        version: 2,
        entries: store.entries,
        payments: store.payments,
      })
    })

    it('saves a bill with no payment', () => {
      const store = useRentEntryStore()
      store.initialize()

      const entry = store.addEntry(submission({}, null))

      expect(store.payments).toEqual([])
      expect(store.getTotalPaid(entry.id)).toBe(0)
    })

    it('keeps the bill and payment after a refresh, unchanged', () => {
      const store = useRentEntryStore()
      store.initialize()
      const entry = store.addEntry(submission())

      const refreshed = refresh()
      expect(refreshed.entries).toEqual([entry])
      expect(refreshed.payments).toEqual(store.payments)
    })

    it('gives each entry a unique id', () => {
      const store = useRentEntryStore()
      store.initialize()

      const first = store.addEntry(submission())
      const second = store.addEntry(submission({ billingMonth: '2026-10' }))

      expect(first.id).not.toBe(second.id)
    })

    it('rejects a second entry for the same tenant and month', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(submission())

      expect(() => store.addEntry(submission({}, null))).toThrow(
        'An entry already exists for this tenant and billing month.',
      )
      expect(store.entries).toHaveLength(1)
    })

    it('still rejects the duplicate after a refresh', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(submission())

      expect(() => refresh().addEntry(submission())).toThrow(
        'An entry already exists for this tenant and billing month.',
      )
    })

    it('allows the same month for a different tenant', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(submission())
      store.addEntry(submission({ tenantId: 'tenant-002' }))

      expect(store.entries).toHaveLength(2)
    })

    it('rejects an invalid bill', () => {
      const store = useRentEntryStore()
      store.initialize()

      expect(() => store.addEntry(submission({ rentAmount: 0 }))).toThrow(
        'This entry is not valid. Check the form and try again.',
      )
      expect(store.entries).toEqual([])
    })

    it.each([
      ['more than the total due', { ...initialPayment, amount: 15750.01 }],
      ['a future paid date', { ...initialPayment, paidDate: '2026-10-04' }],
      ['a zero amount', { ...initialPayment, amount: 0 }],
      ['three decimal places', { ...initialPayment, amount: 100.005 }],
    ])('rejects an initial payment of %s', (_, payment) => {
      const store = useRentEntryStore()
      store.initialize()

      expect(() => store.addEntry(submission({}, payment))).toThrow(
        'This payment is not valid. Check the form and try again.',
      )
      expect(store.entries).toEqual([])
      expect(stored()).toBeNull()
    })

    it('saves neither the bill nor the payment when writing fails', () => {
      const store = useRentEntryStore()
      store.initialize()
      failWrites()

      expect(() => store.addEntry(submission())).toThrow(SAVE_ERROR_MESSAGE)
      expect(store.entries).toEqual([])
      expect(store.payments).toEqual([])
      expect(stored()).toBeNull()
    })
  })

  describe('addPayment', () => {
    // A ₹15,750 bill with ₹10,000 already paid.
    function storeWithBill() {
      const store = useRentEntryStore()
      store.initialize()
      const entry = store.addEntry(submission())
      return { store, entry }
    }

    function payment(entryId: string, overrides: Partial<PaymentInput> = {}): PaymentInput {
      return { entryId, amount: 3000, paidDate: '2026-10-03', notes: 'Bank transfer', ...overrides }
    }

    it('records another payment and keeps the earlier one', () => {
      const { store, entry } = storeWithBill()

      const saved = store.addPayment(payment(entry.id), 'payment-2')

      expect(saved).toEqual({
        ...payment(entry.id),
        id: 'payment-2',
        createdAt: '2026-10-03T06:30:00.000Z',
      })
      expect(store.getPaymentsForEntry(entry.id)).toHaveLength(2)
      expect(store.getTotalPaid(entry.id)).toBe(13000)
    })

    it('keeps the payment after a refresh', () => {
      const { store, entry } = storeWithBill()
      store.addPayment(payment(entry.id))

      const refreshed = refresh()
      expect(refreshed.getPaymentsForEntry(entry.id)).toHaveLength(2)
      expect(refreshed.getTotalPaid(entry.id)).toBe(13000)
    })

    it('settles the bill with exactly the outstanding amount', () => {
      const { store, entry } = storeWithBill()
      store.addPayment(payment(entry.id, { amount: 3000 }))

      store.addPayment(payment(entry.id, { amount: 2750 }))

      expect(store.getTotalPaid(entry.id)).toBe(15750)
    })

    it('rejects more than the outstanding amount', () => {
      const { store, entry } = storeWithBill()
      store.addPayment(payment(entry.id, { amount: 3000 }))

      expect(() => store.addPayment(payment(entry.id, { amount: 3000 }))).toThrow(
        'Amount cannot exceed the outstanding ₹2,750.',
      )
      expect(store.getTotalPaid(entry.id)).toBe(13000)
    })

    it('rejects any payment on a fully paid bill', () => {
      const { store, entry } = storeWithBill()
      store.addPayment(payment(entry.id, { amount: 5750 }))

      expect(() => store.addPayment(payment(entry.id, { amount: 1 }))).toThrow(
        'This bill is already fully paid.',
      )
    })

    it('checks the balance as stored now, not as this tab last saw it', () => {
      const { store, entry } = storeWithBill()
      // Another tab records ₹5,000 without this tab hearing about it.
      saveRentLedger({
        entries: store.entries,
        payments: [
          ...store.payments,
          {
            ...payment(entry.id, { amount: 5000 }),
            id: 'other-tab',
            createdAt: '2026-10-03T06:00:00.000Z',
          },
        ],
      })

      expect(() => store.addPayment(payment(entry.id, { amount: 3000 }))).toThrow(
        'Amount cannot exceed the outstanding ₹750.',
      )
      expect(refresh().getTotalPaid(entry.id)).toBe(15000)
    })

    it('adds paise exactly', () => {
      const { store, entry } = storeWithBill()
      store.addPayment(payment(entry.id, { amount: 0.1 }))
      store.addPayment(payment(entry.id, { amount: 0.2 }))

      expect(store.getTotalPaid(entry.id)).toBe(10000.3)
    })

    it.each([
      ['zero', { amount: 0 }, 'Enter an amount greater than zero.'],
      ['negative', { amount: -5 }, 'Amount cannot be negative.'],
      ['not finite', { amount: Number.NaN }, 'Enter the amount received.'],
      ['three decimal places', { amount: 10.005 }, 'Amount can have at most two decimal places.'],
      ['a future date', { paidDate: '2026-10-04' }, 'This payment is not valid.'],
      ['an invalid date', { paidDate: '2026-02-30' }, 'This payment is not valid.'],
      ['notes over 500 characters', { notes: 'a'.repeat(501) }, 'This payment is not valid.'],
    ])('rejects a payment with %s', (_, overrides, message) => {
      const { store, entry } = storeWithBill()

      expect(() => store.addPayment(payment(entry.id, overrides))).toThrow(message)
      expect(store.getPaymentsForEntry(entry.id)).toHaveLength(1)
    })

    it('rejects a payment for an entry that does not exist', () => {
      const { store } = storeWithBill()

      expect(() => store.addPayment(payment('missing'))).toThrow('This entry no longer exists.')
    })

    it('refuses to save before entries are loaded', () => {
      expect(() => useRentEntryStore().addPayment(payment('entry-1'))).toThrow(
        'Saved entries must load successfully before recording a payment.',
      )
    })

    it('rejects a reused payment id, so a retried save is not recorded twice', () => {
      const { store, entry } = storeWithBill()
      store.addPayment(payment(entry.id, { amount: 1000 }), 'attempt-1')

      expect(() => store.addPayment(payment(entry.id, { amount: 1000 }), 'attempt-1')).toThrow(
        DUPLICATE_PAYMENT_MESSAGE,
      )
      expect(store.getTotalPaid(entry.id)).toBe(11000)
    })

    it('accepts two genuine payments with the same amount and date', () => {
      const { store, entry } = storeWithBill()

      store.addPayment(payment(entry.id, { amount: 1000 }))
      store.addPayment(payment(entry.id, { amount: 1000 }))

      expect(store.getTotalPaid(entry.id)).toBe(12000)
    })

    it('does not record the payment, or change storage, when writing fails', () => {
      const { store, entry } = storeWithBill()
      const before = stored()
      failWrites()

      expect(() => store.addPayment(payment(entry.id))).toThrow(SAVE_ERROR_MESSAGE)
      expect(store.getTotalPaid(entry.id)).toBe(10000)
      expect(stored()).toBe(before)
    })
  })

  // Each tab has its own Pinia but shares localStorage.
  describe('with two tabs open', () => {
    function openTab() {
      setActivePinia(createPinia())
      const store = useRentEntryStore()
      store.initialize()
      return store
    }

    it('keeps both tabs’ entries instead of overwriting', () => {
      const tabA = openTab()
      const tabB = openTab()

      tabA.addEntry(submission())
      tabB.addEntry(submission({ billingMonth: '2026-10' }))

      const refreshed = refresh()
      expect(refreshed.entries.map((e) => e.billingMonth)).toEqual(['2026-09', '2026-10'])
      expect(refreshed.payments).toHaveLength(2)
      expect(tabB.entries).toHaveLength(2)
    })

    it('rejects a month the other tab already saved', () => {
      const tabA = openTab()
      const tabB = openTab()

      tabA.addEntry(submission())

      expect(() => tabB.addEntry(submission())).toThrow(
        'An entry already exists for this tenant and billing month.',
      )
      expect(refresh().entries).toHaveLength(1)
    })

    it('blocks saving, without writing, if the other tab left unreadable data', () => {
      const tab = openTab()
      localStorage.setItem(RENT_LEDGER_STORAGE_KEY, '{not json')

      expect(() => tab.addEntry(submission())).toThrow(LOAD_ERROR_MESSAGE)
      expect(tab.loadError).toBe(LOAD_ERROR_MESSAGE)
      expect(stored()).toBe('{not json')
    })

    it('picks up entries and payments another tab saved', () => {
      const tab = openTab()
      const entry = { ...input, id: 'entry-1', createdAt: '2026-10-03T06:00:00.000Z' }
      saveRentLedger({
        entries: [entry],
        payments: [
          {
            id: 'payment-1',
            entryId: 'entry-1',
            amount: 500,
            paidDate: '2026-10-01',
            notes: '',
            createdAt: '2026-10-03T06:00:00.000Z',
          },
        ],
      })

      window.dispatchEvent(new StorageEvent('storage', { key: RENT_LEDGER_STORAGE_KEY }))

      expect(tab.getEntriesForTenant('tenant-001')).toHaveLength(1)
      expect(tab.getTotalPaid('entry-1')).toBe(500)
    })

    it('ignores changes to other keys', () => {
      const tab = openTab()
      saveRentLedger({
        entries: [{ ...input, id: 'entry-1', createdAt: '2026-10-03T06:00:00.000Z' }],
        payments: [],
      })

      window.dispatchEvent(new StorageEvent('storage', { key: 'rent-tracker-auth-user' }))

      expect(tab.entries).toEqual([])
    })
  })

  describe('getEntriesForTenant', () => {
    it('returns only that tenant’s entries', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(submission())
      store.addEntry(submission({ billingMonth: '2026-10' }))
      store.addEntry(submission({ tenantId: 'tenant-002' }))

      expect(store.getEntriesForTenant('tenant-001')).toHaveLength(2)
      expect(store.getEntriesForTenant('tenant-002')).toHaveLength(1)
      expect(store.getEntriesForTenant('tenant-003')).toEqual([])
    })
  })

  describe('getPaymentsForEntry and getTotalPaid', () => {
    it('cover only that entry’s payments', () => {
      const store = useRentEntryStore()
      store.initialize()
      const september = store.addEntry(submission())
      const october = store.addEntry(submission({ billingMonth: '2026-10' }, null))

      expect(store.getPaymentsForEntry(september.id)).toHaveLength(1)
      expect(store.getPaymentsForEntry(october.id)).toEqual([])
      expect(store.getTotalPaid(september.id)).toBe(10000)
      expect(store.getTotalPaid(october.id)).toBe(0)
    })
  })
})
