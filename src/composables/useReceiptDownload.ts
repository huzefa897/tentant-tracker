import { ref } from 'vue'

import { RECEIPT_ERROR_MESSAGE, ReceiptError, useRentEntryStore } from '@/stores/rentEntry'
import type { Payment } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import { downloadReceiptPdf } from '@/utils/receiptDownload'

// Downloads receipts as PDFs, for every page that offers them. The receipt comes from Django:
// issued if the payment has none (retrying is safe: a payment has one receipt), otherwise its
// saved snapshot. Never changes a payment, and never claims the file was saved: the browser
// decides that. One download at a time: `downloadingId` is the payment's or bill's id while it
// runs, and `error` says what went wrong (cleared by the next attempt). reset()
// when the page moves to another tenant or bill: a download under way still finishes, but its
// error and busy state no longer show.
export function useReceiptDownload() {
  const rentEntryStore = useRentEntryStore()
  const downloadingId = ref<string | null>(null)
  const error = ref<string | null>(null)
  let current = 0

  async function run(id: string, getReceipt: () => Promise<PaymentReceipt>) {
    if (downloadingId.value) return
    const attempt = ++current
    const fail = (message: string) => {
      if (attempt === current) error.value = message
    }
    downloadingId.value = id
    error.value = null
    try {
      let receipt: PaymentReceipt
      try {
        receipt = await getReceipt()
      } catch (err) {
        fail(err instanceof ReceiptError ? err.message : RECEIPT_ERROR_MESSAGE)
        return
      }

      try {
        await downloadReceiptPdf(receipt)
      } catch {
        fail(
          `Receipt ${receipt.reference} is issued, but its PDF couldn't be made. Check your connection and try again.`,
        )
      }
    } finally {
      if (attempt === current) downloadingId.value = null
    }
  }

  // One payment's receipt.
  function downloadPaymentReceipt(tenantId: string, payment: Payment) {
    return run(payment.id, () => rentEntryStore.getReceipt(tenantId, payment))
  }

  // The receipt for the bill's most recent payment.
  function downloadLatestReceipt(tenantId: string, entryId: string) {
    return run(entryId, () => rentEntryStore.getLatestReceipt(tenantId, entryId))
  }

  function reset() {
    current++
    downloadingId.value = null
    error.value = null
  }

  return {
    downloadingId,
    error,
    downloadPaymentReceipt,
    downloadLatestReceipt,
    reset,
  }
}
