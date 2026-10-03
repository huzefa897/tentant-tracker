import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOAD_ERROR_MESSAGE, SAVE_ERROR_MESSAGE, useRentEntryStore } from '@/stores/rentEntry'
import type { RentEntryInput } from '@/types/rentEntry'
import { RENT_ENTRIES_STORAGE_KEY, saveRentEntries } from '@/utils/rentEntryStorage'

const input: RentEntryInput = {
  tenantId: 'tenant-001',
  billingMonth: '2026-09',
  rentAmount: 15000,
  electricityUnits: 75,
  electricityRate: 6,
  waterAmount: 300,
  totalPaid: 10000,
  paidDate: '2026-10-01',
  notes: '',
}

// A fresh Pinia over the same localStorage is what a page refresh looks like.
function refresh() {
  setActivePinia(createPinia())
  const store = useRentEntryStore()
  store.initialize()
  return store
}

function stored() {
  return localStorage.getItem(RENT_ENTRIES_STORAGE_KEY)
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
      expect(store.initialized).toBe(false)
      expect(store.loadError).toBeNull()
    })

    it('loads an empty list when nothing is saved', () => {
      const store = useRentEntryStore()
      store.initialize()

      expect(store.initialized).toBe(true)
      expect(store.entries).toEqual([])
      expect(store.loadError).toBeNull()
    })

    it('leaves an already loaded store alone', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(input)
      localStorage.clear()

      store.initialize()

      expect(store.entries).toHaveLength(1)
    })

    it('reports corrupt data, keeps it and blocks saving', () => {
      localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, '{not json')
      const store = useRentEntryStore()

      store.initialize()

      expect(store.loadError).toBe(LOAD_ERROR_MESSAGE)
      expect(store.initialized).toBe(false)
      expect(() => store.addEntry(input)).toThrow(
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
      localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, '{not json')
      const store = useRentEntryStore()
      store.initialize()

      localStorage.removeItem(RENT_ENTRIES_STORAGE_KEY)
      store.initialize()

      expect(store.loadError).toBeNull()
      expect(store.initialized).toBe(true)
    })
  })

  describe('addEntry', () => {
    it('refuses to save before entries are loaded', () => {
      expect(() => useRentEntryStore().addEntry(input)).toThrow(
        'Saved entries must load successfully before adding an entry.',
      )
      expect(stored()).toBeNull()
    })

    it('saves an entry with an id and timestamp', () => {
      const store = useRentEntryStore()
      store.initialize()

      const entry = store.addEntry(input)

      expect(entry).toEqual({
        ...input,
        id: expect.any(String),
        createdAt: '2026-10-03T06:30:00.000Z',
      })
      expect(store.entries).toEqual([entry])
    })

    it('keeps the entry after a refresh, unchanged', () => {
      const store = useRentEntryStore()
      store.initialize()
      const entry = store.addEntry(input)

      expect(refresh().entries).toEqual([entry])
    })

    it('gives each entry a unique id', () => {
      const store = useRentEntryStore()
      store.initialize()

      const first = store.addEntry(input)
      const second = store.addEntry({ ...input, billingMonth: '2026-10' })

      expect(first.id).not.toBe(second.id)
    })

    it('rejects a second entry for the same tenant and month', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(input)

      expect(() => store.addEntry({ ...input, totalPaid: 0, paidDate: null })).toThrow(
        'An entry already exists for this tenant and billing month.',
      )
      expect(store.entries).toHaveLength(1)
    })

    it('still rejects the duplicate after a refresh', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(input)

      expect(() => refresh().addEntry(input)).toThrow(
        'An entry already exists for this tenant and billing month.',
      )
    })

    it('allows the same month for a different tenant', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(input)
      store.addEntry({ ...input, tenantId: 'tenant-002' })

      expect(store.entries).toHaveLength(2)
    })

    it('rejects an invalid entry', () => {
      const store = useRentEntryStore()
      store.initialize()

      expect(() => store.addEntry({ ...input, totalPaid: 99999 })).toThrow(
        'This entry is not valid. Check the form and try again.',
      )
      expect(() => store.addEntry({ ...input, paidDate: '2026-10-04' })).toThrow(
        'This entry is not valid.',
      )
      expect(store.entries).toEqual([])
    })

    it('does not add the entry when writing fails', () => {
      const store = useRentEntryStore()
      store.initialize()
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      })

      expect(() => store.addEntry(input)).toThrow(SAVE_ERROR_MESSAGE)
      expect(store.entries).toEqual([])
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

      tabA.addEntry(input)
      tabB.addEntry({ ...input, billingMonth: '2026-10' })

      expect(refresh().entries.map((e) => e.billingMonth)).toEqual(['2026-09', '2026-10'])
      expect(tabB.entries).toHaveLength(2)
    })

    it('rejects a month the other tab already saved', () => {
      const tabA = openTab()
      const tabB = openTab()

      tabA.addEntry(input)

      expect(() => tabB.addEntry(input)).toThrow(
        'An entry already exists for this tenant and billing month.',
      )
      expect(refresh().entries).toHaveLength(1)
    })

    it('blocks saving, without writing, if the other tab left unreadable data', () => {
      const tab = openTab()
      localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, '{not json')

      expect(() => tab.addEntry(input)).toThrow(LOAD_ERROR_MESSAGE)
      expect(tab.loadError).toBe(LOAD_ERROR_MESSAGE)
      expect(stored()).toBe('{not json')
    })

    it('picks up entries another tab saved', () => {
      const tab = openTab()
      saveRentEntries([{ ...input, id: 'entry-1', createdAt: '2026-10-03T06:00:00.000Z' }])

      window.dispatchEvent(new StorageEvent('storage', { key: RENT_ENTRIES_STORAGE_KEY }))

      expect(tab.getEntriesForTenant('tenant-001')).toHaveLength(1)
    })

    it('ignores changes to other keys', () => {
      const tab = openTab()
      saveRentEntries([{ ...input, id: 'entry-1', createdAt: '2026-10-03T06:00:00.000Z' }])

      window.dispatchEvent(new StorageEvent('storage', { key: 'rent-tracker-auth-user' }))

      expect(tab.entries).toEqual([])
    })
  })

  describe('getEntriesForTenant', () => {
    it('returns only that tenant’s entries', () => {
      const store = useRentEntryStore()
      store.initialize()
      store.addEntry(input)
      store.addEntry({ ...input, billingMonth: '2026-10' })
      store.addEntry({ ...input, tenantId: 'tenant-002' })

      expect(store.getEntriesForTenant('tenant-001')).toHaveLength(2)
      expect(store.getEntriesForTenant('tenant-002')).toHaveLength(1)
      expect(store.getEntriesForTenant('tenant-003')).toEqual([])
    })
  })
})
