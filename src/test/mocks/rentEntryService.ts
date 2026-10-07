import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import { makeEntry } from '@/test/rentEntryFixtures'
import type { Payment } from '@/types/payment'
import type {
  NewRentEntrySubmission,
  RentEntry,
  RentEntryFilters,
  RentEntryPage,
} from '@/types/rentEntry'
import { calculateOutstanding, getPaymentStatus, sumPayments } from '@/utils/rentCalculations'
import { toPaise } from '@/utils/money'

// A fake rentEntryService that saves, filters and pages like the API, with the bills' payments
// (shared with the fake paymentService, src/test/mocks/paymentService.ts). Use it with
//   vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
// and call resetRentEntryService() in beforeEach. Tests may change `fakeEntries.entries` (the
// saved bills, any tenant), `payments` (with addFakePayment, so the bill's figures follow),
// `pageSize`, `rate` (what the "server" charges per unit; null uses the rate the form
// previewed) and `rent` (the tenancy's rent, charged when the form left the rent unedited; null
// uses the form's).
export const fakeEntries = {
  entries: [] as RentEntry[],
  payments: [] as Payment[],
  pageSize: 12,
  rate: null as number | null,
  rent: null as number | null,
  // What each idempotency key created, as the backend remembers it.
  entryKeys: new Map<string, { entryId: string; request: string }>(),
  paymentKeys: new Map<string, { paymentId: string; request: string }>(),
}

let nextId = 1

// The fake paymentService registers its reset here, so one reset clears both.
const resetHooks: (() => void)[] = []
export function onResetRentEntryService(hook: () => void) {
  resetHooks.push(hook)
}

// The bill with its figures recalculated from its payments, as the backend returns it.
export function withPayments(entry: RentEntry): RentEntry {
  const totalPaid = sumPayments(fakeEntries.payments.filter((p) => p.entryId === entry.id))
  return {
    ...entry,
    totalPaid,
    outstanding: calculateOutstanding(entry.totalDue, totalPaid),
    status: getPaymentStatus(entry.totalDue, totalPaid),
  }
}

// Saves a payment and updates its bill's figures.
export function addFakePayment(payment: Payment): Payment {
  fakeEntries.payments = [...fakeEntries.payments, payment]
  fakeEntries.entries = fakeEntries.entries.map((entry) =>
    entry.id === payment.entryId ? withPayments(entry) : entry,
  )
  return payment
}

export function nextFakeId(prefix: string): string {
  return `${prefix}-${nextId++}`
}

export function exceedsOutstanding(outstanding: number) {
  return new ApiError(
    'conflict',
    'Conflict',
    'payment_exceeds_outstanding',
    {},
    {
      code: 'payment_exceeds_outstanding',
      outstandingAmount: Math.max(outstanding, 0).toFixed(2),
    },
  )
}

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
        (!filters.billingMonth || entry.billingMonth === filters.billingMonth) &&
        (!filters.paymentStatus || entry.status === filters.paymentStatus),
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
  fakeEntries.payments = []
  fakeEntries.pageSize = 12
  fakeEntries.rate = null
  fakeEntries.rent = null
  fakeEntries.entryKeys = new Map()
  fakeEntries.paymentKeys = new Map()
  nextId = 1
  for (const hook of resetHooks) hook()

  rentEntryService.createEntry
    .mockReset()
    .mockImplementation(
      async (
        _propertyId: string,
        tenancyId: string,
        submission: NewRentEntrySubmission,
        idempotencyKey: string,
      ) => {
        const { entry: input, initialPayment } = submission
        // A retry: the bill this key created, as it is now.
        const request = JSON.stringify({ tenancyId, ...submission })
        const known = fakeEntries.entryKeys.get(idempotencyKey)
        if (known) {
          if (known.request !== request) {
            throw new ApiError('conflict', 'Conflict', 'idempotency_conflict')
          }
          return fakeEntries.entries.find((entry) => entry.id === known.entryId)!
        }

        if (
          fakeEntries.entries.some(
            (entry) => entry.tenantId === tenancyId && entry.billingMonth === input.billingMonth,
          )
        ) {
          throw new ApiError('conflict', 'Conflict', 'duplicate_billing_month')
        }

        const entry = makeEntry({
          id: nextFakeId('saved'),
          tenantId: tenancyId,
          billingMonth: input.billingMonth,
          rentAmount:
            input.useTenancyRent && fakeEntries.rent !== null ? fakeEntries.rent : input.rentAmount,
          electricityUnits: input.electricityUnits,
          electricityRate: fakeEntries.rate ?? input.electricityRate,
          waterAmount: input.waterAmount,
          notes: input.notes,
          createdAt: new Date().toISOString(),
        })
        if (initialPayment && toPaise(initialPayment.amount) > toPaise(entry.totalDue)) {
          throw exceedsOutstanding(entry.totalDue)
        }

        fakeEntries.entries = [...fakeEntries.entries, entry]
        fakeEntries.entryKeys.set(idempotencyKey, { entryId: entry.id, request })
        if (initialPayment) {
          addFakePayment({
            id: nextFakeId('payment'),
            entryId: entry.id,
            ...initialPayment,
            createdAt: new Date().toISOString(),
            receipt: null,
          })
        }
        return fakeEntries.entries.find((item) => item.id === entry.id)!
      },
    )
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
