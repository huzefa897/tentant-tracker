import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import { fakeEntries, nextFakeId, onResetRentEntryService } from '@/test/mocks/rentEntryService'
import { makeReceipt } from '@/test/rentEntryFixtures'
import type { PaymentReceipt } from '@/types/receipt'

// A fake receiptService that issues one receipt per payment of the fake rentEntryService, like
// the API: issuing again returns the same receipt (created: false), getting one that wasn't
// issued is 'not-found', and the payment then carries the receipt's id and reference. Use it with
//   vi.mock('@/services/receipt.service', () => import('@/test/mocks/receiptService'))
// and call resetRentEntryService(), which also resets this fake, in beforeEach.

// The real helper: it only reads an error.
const actual = await vi.importActual<typeof import('@/services/receipt.service')>(
  '@/services/receipt.service',
)
export const receiptConfigurationProblem = actual.receiptConfigurationProblem

// Issued receipts by payment id.
export const fakeReceipts = new Map<string, PaymentReceipt>()

export const receiptService = {
  issueReceipt: vi.fn(),
  getReceipt: vi.fn(),
}

function findPayment(tenancyId: string, entryId: string, paymentId: string) {
  const entry = fakeEntries.entries.find((e) => e.id === entryId && e.tenantId === tenancyId)
  const payment = fakeEntries.payments.find((p) => p.id === paymentId && p.entryId === entryId)
  if (!entry || !payment) throw new ApiError('not-found', 'Not found')
  return { entry, payment }
}

export function resetReceiptService() {
  fakeReceipts.clear()
  receiptService.issueReceipt
    .mockReset()
    .mockImplementation(
      async (_propertyId: string, tenancyId: string, entryId: string, paymentId: string) => {
        const { entry, payment } = findPayment(tenancyId, entryId, paymentId)
        const existing = fakeReceipts.get(paymentId)
        if (existing) return { receipt: existing, created: false }

        const id = nextFakeId('receipt')
        const receipt = makeReceipt({
          id,
          reference: `${entry.tenantId}_Rent_${entry.billingMonth}_${id}`,
          paymentId,
          entryId,
          billingMonth: entry.billingMonth,
          paymentAmount: payment.amount,
          paidDate: payment.paidDate,
          paymentNotes: payment.notes,
        })
        fakeReceipts.set(paymentId, receipt)
        fakeEntries.payments = fakeEntries.payments.map((p) =>
          p.id === paymentId
            ? { ...p, receipt: { id, reference: receipt.reference, status: 'issued' as const } }
            : p,
        )
        return { receipt, created: true }
      },
    )
  receiptService.getReceipt
    .mockReset()
    .mockImplementation(
      async (_propertyId: string, tenancyId: string, entryId: string, paymentId: string) => {
        findPayment(tenancyId, entryId, paymentId)
        const receipt = fakeReceipts.get(paymentId)
        if (!receipt) throw new ApiError('not-found', 'Not found')
        return receipt
      },
    )
}

resetReceiptService()
onResetRentEntryService(resetReceiptService)
