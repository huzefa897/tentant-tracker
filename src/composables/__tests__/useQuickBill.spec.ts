import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useQuickBill } from '@/composables/useQuickBill'
import { EntrySaveError, useRentEntryStore } from '@/stores/rentEntry'
import { makeEntry } from '@/test/rentEntries'
import { testTenants } from '@/test/mocks/tenantService'
import type { NewRentEntrySubmission } from '@/types/rentEntry'

vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
vi.mock('@/services/meterReading.service', () => import('@/test/mocks/meterReadingService'))

const submission = {
  entry: { tenantId: 'tenant-001', closingReading: null },
  initialPayment: null,
} as unknown as NewRentEntrySubmission

let addEntry: ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  addEntry = vi.fn()
  useRentEntryStore().addEntry = addEntry as never
})

describe('useQuickBill', () => {
  it('returns the saved bill', async () => {
    const entry = makeEntry()
    addEntry.mockResolvedValue(entry)
    const bill = useQuickBill(() => testTenants[0]!)

    expect(await bill.save(submission)).toEqual(entry)
    expect(bill.saveError.value).toBeNull()
    expect(bill.saving.value).toBe(false)
  })

  it('keeps the error, and the bill already saved for that month', async () => {
    const existing = makeEntry()
    addEntry.mockRejectedValue(new EntrySaveError('Already saved.', existing))
    const bill = useQuickBill(() => testTenants[0]!)

    expect(await bill.save(submission)).toBeNull()
    expect(bill.saveError.value).toBe('Already saved.')
    expect(bill.existingEntry.value).toEqual(existing)
  })

  it('retries an uncertain failure with the same key, and a definite one with a new key', async () => {
    const bill = useQuickBill(() => testTenants[0]!)
    const keys: string[] = []
    addEntry.mockImplementation(async (_submission: unknown, key: string) => {
      keys.push(key)
      throw new EntrySaveError('Failed.', null, keys.length === 1)
    })

    await bill.save(submission)
    await bill.save(submission)
    await bill.save(submission)

    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[1])
  })

  it('starts the next bill with a new key and no error', async () => {
    const bill = useQuickBill(() => testTenants[0]!)
    const keys: string[] = []
    addEntry.mockImplementation(async (_submission: unknown, key: string) => {
      keys.push(key)
      throw new EntrySaveError('Failed.', null, true)
    })
    await bill.save(submission)

    bill.reset()
    expect(bill.saveError.value).toBeNull()
    await bill.save(submission)

    expect(keys[1]).not.toBe(keys[0])
  })
})
