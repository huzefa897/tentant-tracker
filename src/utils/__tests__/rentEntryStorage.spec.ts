import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RentEntry } from '@/types/rentEntry'
import {
  loadRentEntries,
  RENT_ENTRIES_STORAGE_KEY,
  saveRentEntries,
} from '@/utils/rentEntryStorage'

const entry: RentEntry = {
  id: 'entry-001',
  tenantId: 'tenant-001',
  billingMonth: '2026-10',
  rentAmount: 15000,
  electricityUnits: 75,
  electricityRate: 6,
  waterAmount: 300,
  totalPaid: 10000,
  paidDate: '2026-10-03',
  notes: '',
  createdAt: '2026-10-03T06:00:00.000Z',
}

function store(value: unknown) {
  localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, JSON.stringify(value))
}

function storeEntries(...entries: unknown[]) {
  store({ version: 1, entries })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('saveRentEntries', () => {
  it('writes a versioned wrapper under the storage key', () => {
    saveRentEntries([entry])

    expect(JSON.parse(localStorage.getItem(RENT_ENTRIES_STORAGE_KEY)!)).toEqual({
      version: 1,
      entries: [entry],
    })
  })

  it('does not store calculated totals', () => {
    saveRentEntries([entry])

    const raw = localStorage.getItem(RENT_ENTRIES_STORAGE_KEY)!
    expect(raw).not.toContain('totalDue')
    expect(raw).not.toContain('outstanding')
    expect(raw).not.toContain('status')
  })

  it('lets a failed write throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    expect(() => saveRentEntries([entry])).toThrow('Quota exceeded')
  })
})

describe('loadRentEntries', () => {
  it('returns no entries when nothing is stored', () => {
    expect(loadRentEntries()).toEqual([])
  })

  it('round-trips saved entries unchanged', () => {
    const unpaid = {
      ...entry,
      id: 'entry-002',
      billingMonth: '2026-09',
      totalPaid: 0,
      paidDate: null,
    }
    saveRentEntries([entry, unpaid])

    expect(loadRentEntries()).toEqual([entry, unpaid])
  })

  it('drops unknown extra fields', () => {
    storeEntries({ ...entry, totalDue: 15750 })

    expect(loadRentEntries()).toEqual([entry])
  })

  it('does not reject a paid date after today (the device clock may have changed)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 1))
    storeEntries(entry)

    expect(loadRentEntries()).toEqual([entry])
  })

  describe('rejects corrupt data', () => {
    it('that is not JSON', () => {
      localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, '{not json')

      expect(() => loadRentEntries()).toThrow(SyntaxError)
    })

    it.each([
      ['an array', [entry]],
      ['null', null],
      ['a missing version', { entries: [entry] }],
      ['another version', { version: 2, entries: [entry] }],
      ['missing entries', { version: 1 }],
      ['entries that are not an array', { version: 1, entries: {} }],
    ])('with %s as the wrapper', (_, value) => {
      store(value)

      expect(() => loadRentEntries()).toThrow('Stored rent entries have an unknown format.')
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
      ['an overpayment', { ...entry, totalPaid: 99999 }],
      ['a payment without a paid date', { ...entry, paidDate: null }],
      ['a paid date with no payment', { ...entry, totalPaid: 0 }],
      ['an invalid paid date', { ...entry, paidDate: '2026-02-30' }],
      ['non-string notes', { ...entry, notes: 5 }],
      ['notes over 500 characters', { ...entry, notes: 'a'.repeat(501) }],
      ['an invalid timestamp', { ...entry, createdAt: 'yesterday' }],
    ])('with an entry that has %s', (_, value) => {
      storeEntries(value)

      expect(() => loadRentEntries()).toThrow(/Stored rent entry 0 is invalid/)
    })

    it('with repeated ids', () => {
      storeEntries(entry, { ...entry, billingMonth: '2026-09' })

      expect(() => loadRentEntries()).toThrow('Stored rent entries contain duplicates.')
    })

    it('with repeated tenant and month', () => {
      storeEntries(entry, { ...entry, id: 'entry-002' })

      expect(() => loadRentEntries()).toThrow('Stored rent entries contain duplicates.')
    })

    it('without changing what is stored', () => {
      localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, '{not json')

      expect(() => loadRentEntries()).toThrow()
      expect(localStorage.getItem(RENT_ENTRIES_STORAGE_KEY)).toBe('{not json')
    })
  })
})
