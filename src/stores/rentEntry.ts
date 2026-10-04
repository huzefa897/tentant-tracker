import { onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import type { Payment, PaymentInput } from '@/types/payment'
import type { NewRentEntrySubmission, RentEntry } from '@/types/rentEntry'
import type { RentLedger } from '@/types/rentLedger'
import { toDateValue } from '@/utils/date'
import { validatePaymentInput } from '@/utils/paymentValidation'
import { calculateOutstanding, calculateTotalDue, sumPayments } from '@/utils/rentCalculations'
import { validateRentEntryInput } from '@/utils/rentEntryValidation'
import { loadRentLedger, RENT_LEDGER_STORAGE_KEY, saveRentLedger } from '@/utils/rentLedgerStorage'

export const LOAD_ERROR_MESSAGE = 'Saved entries could not be loaded. Please retry.'
export const SAVE_ERROR_MESSAGE =
  'Unable to save on this device. Your form has been kept open. Please try again.'
export const DUPLICATE_PAYMENT_MESSAGE = 'This payment has already been recorded.'

// Entries and their payments persist together in localStorage (utils/rentLedgerStorage.ts)
// until there's a backend.
export const useRentEntryStore = defineStore('rentEntry', () => {
  const entries = ref<RentEntry[]>([])
  const payments = ref<Payment[]>([])
  const initialized = ref(false)
  const loadError = ref<string | null>(null)

  // Replaces state with what's stored (migrating old data first). On failure the stored data is
  // left untouched and saving stays blocked until a load succeeds.
  function load(): boolean {
    try {
      const ledger = loadRentLedger()
      entries.value = ledger.entries
      payments.value = ledger.payments
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
  function commit(next: RentLedger) {
    try {
      saveRentLedger(next)
    } catch {
      throw new Error(SAVE_ERROR_MESSAGE)
    }

    entries.value = next.entries
    payments.value = next.payments
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

    commit({ entries: [...entries.value, entry], payments: nextPayments })

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

    commit({ entries: entries.value, payments: [...payments.value, payment] })

    return payment
  }

  return {
    entries,
    payments,
    initialized,
    loadError,
    initialize,
    getEntriesForTenant,
    getPaymentsForEntry,
    getTotalPaid,
    addEntry,
    addPayment,
  }
})
