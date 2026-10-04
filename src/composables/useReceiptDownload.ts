import { ref } from 'vue'

import { useRentEntryStore } from '@/stores/rentEntry'
import { downloadReceiptPdf } from '@/utils/receiptDownload'

export const RECEIPT_PDF_ERROR_MESSAGE =
  'The receipt is saved, but its PDF could not be created. Please try again.'

// Issues a payment's receipt (or reuses the one already issued, so repeated clicks never issue
// a second) and downloads it as a PDF. Failures show through `error`; the payment is never
// affected.
export function useReceiptDownload() {
  const rentEntryStore = useRentEntryStore()
  // The payment whose receipt is being prepared, so its button can show progress.
  const downloadingPaymentId = ref<string | null>(null)
  const error = ref<string | null>(null)

  async function downloadReceipt(paymentId: string): Promise<boolean> {
    if (downloadingPaymentId.value) return false

    downloadingPaymentId.value = paymentId
    error.value = null

    try {
      let receipt
      try {
        receipt = rentEntryStore.issueReceipt(paymentId)
      } catch (issueError) {
        error.value =
          issueError instanceof Error
            ? issueError.message
            : 'Unable to issue the receipt. Please try again.'
        return false
      }

      try {
        await downloadReceiptPdf(receipt)
      } catch {
        error.value = RECEIPT_PDF_ERROR_MESSAGE
        return false
      }

      return true
    } finally {
      downloadingPaymentId.value = null
    }
  }

  function clearError() {
    error.value = null
  }

  return { downloadingPaymentId, error, downloadReceipt, clearError }
}
