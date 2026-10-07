import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import {
  addFakePayment,
  exceedsOutstanding,
  fakeEntries,
  nextFakeId,
  onResetRentEntryService,
} from '@/test/mocks/rentEntryService'
import type { Payment, PaymentInput, RecordedPayment } from '@/types/payment'
import { toPaise } from '@/utils/money'

// A fake paymentService that records payments against the fake rentEntryService's bills like
// the API: it checks the balance, remembers idempotency keys (a retry returns the payment it
// recorded) and updates the bill's figures. Use it with
//   vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
// and call resetRentEntryService(), which also resets this fake, in beforeEach.

// The real helper: it only reads an error.
const actual = await vi.importActual<typeof import('@/services/payment.service')>(
  '@/services/payment.service',
)
export const outstandingFromConflict = actual.outstandingFromConflict

export const paymentService = {
  recordPayment: vi.fn(),
  getPayments: vi.fn(),
}

// Newest paid date first, then newest recorded, then id: the backend's order.
function newestFirst(payments: Payment[]): Payment[] {
  return [...payments].sort(
    (a, b) =>
      b.paidDate.localeCompare(a.paidDate) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  )
}

function findEntry(tenancyId: string, entryId: string) {
  const entry = fakeEntries.entries.find(
    (item) => item.id === entryId && item.tenantId === tenancyId,
  )
  if (!entry) throw new ApiError('not-found', 'Not found')
  return entry
}

export function resetPaymentService() {
  paymentService.recordPayment
    .mockReset()
    .mockImplementation(
      async (
        _propertyId: string,
        tenancyId: string,
        input: PaymentInput,
        idempotencyKey: string,
      ): Promise<RecordedPayment> => {
        const entry = findEntry(tenancyId, input.entryId)
        const request = JSON.stringify(input)

        // Before the balance check: a retry of the payment that settled the bill succeeds.
        const known = fakeEntries.paymentKeys.get(idempotencyKey)
        if (known) {
          if (known.request !== request) {
            throw new ApiError('conflict', 'Conflict', 'idempotency_conflict')
          }
          return {
            payment: fakeEntries.payments.find((p) => p.id === known.paymentId)!,
            entry: findEntry(tenancyId, input.entryId),
            replayed: true,
          }
        }

        if (toPaise(input.amount) > toPaise(entry.outstanding)) {
          throw exceedsOutstanding(entry.outstanding)
        }

        const payment = addFakePayment({
          id: nextFakeId('payment'),
          ...input,
          createdAt: new Date().toISOString(),
        })
        fakeEntries.paymentKeys.set(idempotencyKey, { paymentId: payment.id, request })
        return { payment, entry: findEntry(tenancyId, input.entryId), replayed: false }
      },
    )
  paymentService.getPayments
    .mockReset()
    .mockImplementation(async (_propertyId: string, tenancyId: string, entryId: string) => {
      findEntry(tenancyId, entryId)
      return newestFirst(fakeEntries.payments.filter((p) => p.entryId === entryId))
    })
}

resetPaymentService()
onResetRentEntryService(resetPaymentService)
