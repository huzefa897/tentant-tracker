import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRentEntryStore } from '@/stores/rentEntry'
import type { RentEntryInput } from '@/types/rentEntry'

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

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-03T06:30:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRentEntryStore', () => {
  it('starts empty', () => {
    expect(useRentEntryStore().entries).toEqual([])
  })

  it('saves an entry with an id and timestamp', () => {
    const store = useRentEntryStore()

    const entry = store.addEntry(input)

    expect(entry).toEqual({
      ...input,
      id: expect.any(String),
      createdAt: '2026-10-03T06:30:00.000Z',
    })
    expect(store.entries).toEqual([entry])
  })

  it('gives each entry a unique id', () => {
    const store = useRentEntryStore()

    const first = store.addEntry(input)
    const second = store.addEntry({ ...input, billingMonth: '2026-10' })

    expect(first.id).not.toBe(second.id)
  })

  it('rejects a second entry for the same tenant and month', () => {
    const store = useRentEntryStore()
    store.addEntry(input)

    expect(() => store.addEntry({ ...input, totalPaid: 0, paidDate: null })).toThrow(
      'An entry already exists for this tenant and billing month.',
    )
    expect(store.entries).toHaveLength(1)
  })

  it('allows the same month for a different tenant', () => {
    const store = useRentEntryStore()
    store.addEntry(input)
    store.addEntry({ ...input, tenantId: 'tenant-002' })

    expect(store.entries).toHaveLength(2)
  })
})
