import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import { makeEntry } from '@/test/rentEntryFixtures'
import type { RentEntry, RentEntryFilters, RentEntryInput, RentEntryPage } from '@/types/rentEntry'

// A fake rentEntryService that saves, filters and pages like the API. Use it with
//   vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
// and call resetRentEntryService() in beforeEach. Tests may change `fakeEntries.entries` (the
// saved bills, any tenant), `pageSize` and `rate` (what the "server" charges per unit; null
// uses the rate the form previewed).
export const fakeEntries = {
  entries: [] as RentEntry[],
  pageSize: 12,
  rate: null as number | null,
}

let nextId = 1

export function pageOf(
  entries: RentEntry[],
  tenantId: string,
  filters: RentEntryFilters = {},
  pageSize = fakeEntries.pageSize,
): RentEntryPage {
  const matches = entries
    .filter(
      (entry) =>
        entry.tenantId === tenantId &&
        (!filters.year || entry.billingMonth.startsWith(`${filters.year}-`)) &&
        (!filters.billingMonth || entry.billingMonth === filters.billingMonth),
    )
    .sort((a, b) => b.billingMonth.localeCompare(a.billingMonth))
  const page = filters.page ?? 1
  const start = (page - 1) * pageSize

  return {
    entries: matches.slice(start, start + pageSize),
    count: matches.length,
    page,
    hasNext: start + pageSize < matches.length,
    hasPrevious: page > 1,
  }
}

export const rentEntryService = {
  createEntry: vi.fn(),
  getEntries: vi.fn(),
  getEntry: vi.fn(),
}

export function resetRentEntryService() {
  fakeEntries.entries = []
  fakeEntries.pageSize = 12
  fakeEntries.rate = null
  nextId = 1

  rentEntryService.createEntry
    .mockReset()
    .mockImplementation(async (_propertyId: string, tenancyId: string, input: RentEntryInput) => {
      if (
        fakeEntries.entries.some(
          (entry) => entry.tenantId === tenancyId && entry.billingMonth === input.billingMonth,
        )
      ) {
        throw new ApiError('conflict', 'Conflict', 'duplicate_billing_month')
      }

      const entry = makeEntry({
        id: `saved-${nextId++}`,
        tenantId: tenancyId,
        billingMonth: input.billingMonth,
        rentAmount: input.rentAmount,
        electricityUnits: input.electricityUnits,
        electricityRate: fakeEntries.rate ?? input.electricityRate,
        waterAmount: input.waterAmount,
        notes: input.notes,
        createdAt: new Date().toISOString(),
      })
      fakeEntries.entries = [...fakeEntries.entries, entry]
      return entry
    })
  rentEntryService.getEntries
    .mockReset()
    .mockImplementation(
      async (_propertyId: string, tenancyId: string, filters?: RentEntryFilters) =>
        pageOf(fakeEntries.entries, tenancyId, filters),
    )
  rentEntryService.getEntry
    .mockReset()
    .mockImplementation(async (_propertyId: string, tenancyId: string, entryId: string) => {
      const entry = fakeEntries.entries.find(
        (item) => item.id === entryId && item.tenantId === tenancyId,
      )
      if (!entry) throw new ApiError('not-found', 'Not found')
      return entry
    })
}

resetRentEntryService()
