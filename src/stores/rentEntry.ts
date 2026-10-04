import { onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import { receiptIssuer } from '@/config/receiptIssuer'
import { useTenantStore } from '@/stores/tenant'
import type { Payment, PaymentInput } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import type { NewRentEntrySubmission, RentEntry } from '@/types/rentEntry'
import type { RentLedger } from '@/types/rentLedger'
import { previousMonthValue, toDateValue } from '@/utils/date'
import { validatePaymentInput } from '@/utils/paymentValidation'
import { validateReceiptIssuer } from '@/utils/receiptValidation'
import { calculateOutstanding, calculateTotalDue, sumPayments } from '@/utils/rentCalculations'
import { validateRentEntryInput } from '@/utils/rentEntryValidation'
import { loadRentLedger, RENT_LEDGER_STORAGE_KEY, saveRentLedger } from '@/utils/rentLedgerStorage'

export const LOAD_ERROR_MESSAGE = 'Saved entries could not be loaded. Please retry.'
export const SAVE_ERROR_MESSAGE =
  'Unable to save on this device. Your form has been kept open. Please try again.'
export const DUPLICATE_PAYMENT_MESSAGE = 'This payment has already been recorded.'
export const RECEIPT_SAVE_ERROR_MESSAGE =
  'Unable to save the receipt on this device. The payment is still recorded. Please try again.'

// "RCP-102-202609" for a bill's first payment, "RCP-102-202609-2" for its second. Derived from
// the payment's place among its bill's payments, not a counter, so it's the same whenever it's
// issued. Saved with the receipt and never regenerated. A backend can allocate references
// under a uniqueness constraint later.
export function receiptReferenceFor(
  flatNumber: string,
  billingMonth: string,
  paymentNumber: number,
): string {
  const flat = flatNumber.trim().replace(/\s+/g, '-')
  const base = `RCP-${flat}-${billingMonth.replace('-', '')}`
  return paymentNumber > 1 ? `${base}-${paymentNumber}` : base
}

// Entries, their payments and the receipts for those payments persist together in localStorage
// (utils/rentLedgerStorage.ts) until there's a backend.
export const useRentEntryStore = defineStore('rentEntry', () => {
  const entries = ref<RentEntry[]>([])
  const payments = ref<Payment[]>([])
  const receipts = ref<PaymentReceipt[]>([])
  const initialized = ref(false)
  const loadError = ref<string | null>(null)

  // Replaces state with what's stored (migrating old data first). On failure the stored data is
  // left untouched and saving stays blocked until a load succeeds.
  function load(): boolean {
    try {
      const ledger = loadRentLedger()
      entries.value = ledger.entries
      payments.value = ledger.payments
      receipts.value = ledger.receipts
      initialized.value = true
      loadError.value = null
      return true
    } catch {
      initialized.value = false
      loadError.value = LOAD_ERROR_MESSAGE
      return false
    }
  }

  // Another tab saved (or storage was cleared, key null): pick up its changes.
  function handleStorage(event: StorageEvent) {
    if (event.key === RENT_LEDGER_STORAGE_KEY || event.key === null) load()
  }

  let listening = false
  onScopeDispose(() => window.removeEventListener('storage', handleStorage))

  // Safe to call from every page that needs entries; also the Retry action after a failure.
  function initialize() {
    if (!listening) {
      window.addEventListener('storage', handleStorage)
      listening = true
    }

    if (initialized.value) return

    load()
  }

  function getEntriesForTenant(tenantId: string): RentEntry[] {
    return entries.value.filter((entry) => entry.tenantId === tenantId)
  }

  function getPaymentsForEntry(entryId: string): Payment[] {
    return payments.value.filter((payment) => payment.entryId === entryId)
  }

  // Always the sum of the entry's payment records, never a stored figure.
  function getTotalPaid(entryId: string): number {
    return sumPayments(getPaymentsForEntry(entryId))
  }

  function getReceipt(receiptId: string): PaymentReceipt | null {
    return receipts.value.find((receipt) => receipt.id === receiptId) ?? null
  }

  function getReceiptForPayment(paymentId: string): PaymentReceipt | null {
    return receipts.value.find((receipt) => receipt.paymentId === paymentId) ?? null
  }

  // Shared start of every write. Saving without the stored ledger would overwrite it, and
  // re-reading right before writing picks up what another tab saved since this one loaded
  // (writing this tab's stale copy would erase it). Read, check and write happen in one
  // synchronous step; a backend must do this atomically for real.
  function reloadBeforeWrite(action: string) {
    if (!initialized.value || loadError.value) {
      throw new Error(`Saved entries must load successfully before ${action}.`)
    }

    if (!load()) {
      throw new Error(LOAD_ERROR_MESSAGE)
    }
  }

  // Write first: only a successful write updates state and lets the page confirm.
  function commit(next: RentLedger, saveErrorMessage = SAVE_ERROR_MESSAGE) {
    try {
      saveRentLedger(next)
    } catch {
      throw new Error(saveErrorMessage)
    }

    entries.value = next.entries
    payments.value = next.payments
    receipts.value = next.receipts
  }

  // Saves the bill and its optional initial payment in one write: never one without the other.
  function addEntry(submission: NewRentEntrySubmission): RentEntry {
    const { entry: input, initialPayment } = submission
    const today = toDateValue(new Date())

    if (Object.keys(validateRentEntryInput(input)).length > 0) {
      throw new Error('This entry is not valid. Check the form and try again.')
    }

    if (
      initialPayment &&
      Object.keys(
        validatePaymentInput(
          { ...initialPayment, entryId: 'new-entry' },
          { today, outstanding: calculateTotalDue(input) },
        ),
      ).length > 0
    ) {
      throw new Error('This payment is not valid. Check the form and try again.')
    }

    reloadBeforeWrite('adding an entry')

    // One bill per tenant per month. The backend must enforce this too once it exists.
    const duplicate = entries.value.some(
      (entry) => entry.tenantId === input.tenantId && entry.billingMonth === input.billingMonth,
    )

    if (duplicate) {
      throw new Error('An entry already exists for this tenant and billing month.')
    }

    const createdAt = new Date().toISOString()
    const entry: RentEntry = { ...input, id: crypto.randomUUID(), createdAt }
    const nextPayments = initialPayment
      ? [
          ...payments.value,
          { ...initialPayment, entryId: entry.id, id: crypto.randomUUID(), createdAt },
        ]
      : payments.value

    commit({ entries: [...entries.value, entry], payments: nextPayments, receipts: receipts.value })

    return entry
  }

  // `id` is generated once per form submission and reused on retries, so a retried save that
  // had in fact succeeded can't record the payment twice. Same amount and date is fine:
  // two genuine payments can match.
  function addPayment(input: PaymentInput, id: string = crypto.randomUUID()): Payment {
    reloadBeforeWrite('recording a payment')

    const entry = entries.value.find((item) => item.id === input.entryId)
    if (!entry) {
      throw new Error('This entry no longer exists.')
    }

    if (payments.value.some((payment) => payment.id === id)) {
      throw new Error(DUPLICATE_PAYMENT_MESSAGE)
    }

    // Recalculated from what's stored now: the form's preview may be stale.
    const outstanding = calculateOutstanding(calculateTotalDue(entry), getTotalPaid(entry.id))
    const errors = validatePaymentInput(input, { today: toDateValue(new Date()), outstanding })

    if (Object.keys(errors).length > 0) {
      throw new Error(errors.amount ?? 'This payment is not valid. Check the form and try again.')
    }

    const payment: Payment = { ...input, id, createdAt: new Date().toISOString() }

    commit({
      entries: entries.value,
      payments: [...payments.value, payment],
      receipts: receipts.value,
    })

    return payment
  }

  // Issues the receipt for one payment: a snapshot of the payment, its bill, the tenant and the
  // issuer as they are now, saved so every reprint shows the same thing. A payment that
  // already has a receipt gets that one back, so repeated clicks never issue a second.
  // A failure leaves the payment recorded and no receipt in state.
  function issueReceipt(paymentId: string): PaymentReceipt {
    reloadBeforeWrite('issuing a receipt')

    const existing = getReceiptForPayment(paymentId)
    if (existing) return existing

    const payment = payments.value.find((item) => item.id === paymentId)
    if (!payment) {
      throw new Error('This payment no longer exists.')
    }

    const entry = entries.value.find((item) => item.id === payment.entryId)
    if (!entry) {
      throw new Error('This entry no longer exists.')
    }

    const tenant = useTenantStore().tenants.find((item) => item.id === entry.tenantId)
    if (!tenant) {
      throw new Error('Tenant details are unavailable, so no receipt was issued. Please try again.')
    }

    // A deployed build must not print the placeholder address on a real receipt.
    const issuerError = validateReceiptIssuer(receiptIssuer, {
      allowPlaceholderAddress: import.meta.env.DEV,
    })
    if (issuerError) {
      throw new Error(issuerError)
    }

    // The bill as it stood right after this payment: the payments recorded before it, plus it.
    const billPayments = getPaymentsForEntry(entry.id)
    const paymentNumber = billPayments.findIndex((item) => item.id === payment.id) + 1
    const totalDue = calculateTotalDue(entry)
    const totalPaid = sumPayments(billPayments.slice(0, paymentNumber))

    const previousEntry = entries.value.find(
      (item) =>
        item.tenantId === entry.tenantId &&
        item.billingMonth === previousMonthValue(entry.billingMonth),
    )
    const previousMonthOutstanding = previousEntry
      ? calculateOutstanding(calculateTotalDue(previousEntry), getTotalPaid(previousEntry.id))
      : 0

    // References must be unique. A clash (e.g. a flat reused under another tenant id) falls
    // back to one that includes the payment id, which can't clash.
    let reference = receiptReferenceFor(tenant.flatNumber, entry.billingMonth, paymentNumber)
    if (receipts.value.some((item) => item.reference === reference)) {
      reference = `${reference}-${payment.id}`
    }

    const receipt: PaymentReceipt = {
      id: crypto.randomUUID(),
      reference,
      paymentId: payment.id,
      entryId: entry.id,
      issuedAt: new Date().toISOString(),
      // Copies, so the snapshot never shares objects with the config or the tenant list.
      issuer: {
        name: receiptIssuer.name.trim(),
        managerName: receiptIssuer.managerName.trim(),
        address: receiptIssuer.address.trim(),
        contactNumber: receiptIssuer.contactNumber,
        email: receiptIssuer.email,
      },
      tenant: {
        name: tenant.name,
        flatNumber: tenant.flatNumber,
        mobileNumber: tenant.mobileNumber,
        depositAmount: tenant.depositAmount,
      },
      billingMonth: entry.billingMonth,
      rentDueDay: tenant.rentDueDay,
      charges: {
        rentAmount: entry.rentAmount,
        electricityUnits: entry.electricityUnits,
        electricityRate: entry.electricityRate,
        waterAmount: entry.waterAmount,
      },
      totalDue,
      totalPaid,
      outstanding: calculateOutstanding(totalDue, totalPaid),
      previousMonthOutstanding,
      paymentAmount: payment.amount,
      paidDate: payment.paidDate,
      paymentNotes: payment.notes,
    }

    commit(
      { entries: entries.value, payments: payments.value, receipts: [...receipts.value, receipt] },
      RECEIPT_SAVE_ERROR_MESSAGE,
    )

    return receipt
  }

  return {
    entries,
    payments,
    receipts,
    initialized,
    loadError,
    initialize,
    getEntriesForTenant,
    getPaymentsForEntry,
    getTotalPaid,
    getReceipt,
    getReceiptForPayment,
    addEntry,
    addPayment,
    issueReceipt,
  }
})
