import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, RATE_LIMITED_MESSAGE } from '@/services/apiError'
import { outstandingFromConflict, paymentService } from '@/services/payment.service'
import { receiptConfigurationProblem, receiptService } from '@/services/receipt.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { useAccessStore } from '@/stores/access'
import type { Payment, PaymentInput, RecordedPayment } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import type { NewRentEntrySubmission, PaymentStatus, RentEntry } from '@/types/rentEntry'
import { formatINR } from '@/utils/currency'
import { validatePaymentDraft, validatePaymentInput } from '@/utils/paymentValidation'
import { validateRentEntryInput } from '@/utils/rentEntryValidation'

export type EntryListStatus = 'idle' | 'loading' | 'ready' | 'error'

export const ENTRIES_LOAD_ERROR_MESSAGE = 'Unable to load rent entries. Please try again.'
export const SAVE_ERROR_MESSAGE =
  'Unable to save the entry. Your form has been kept. Please try again.'
export const DUPLICATE_ENTRY_MESSAGE = 'An entry already exists for this tenant and billing month.'
export const SAVE_UNCONFIRMED_MESSAGE =
  "We couldn't confirm whether the entry was saved. Save again to retry: it won't be saved twice."
export const ENTRY_KEY_CONFLICT_MESSAGE =
  'Your earlier attempt was already saved with different details. Open it to check it before adding another.'
export const PAYMENTS_LOAD_ERROR_MESSAGE = 'Unable to load payments. Please try again.'
export const PAYMENT_SAVE_ERROR_MESSAGE =
  'Unable to save the payment. Your details have been kept. Please try again.'
export const PAYMENT_UNCONFIRMED_MESSAGE =
  "We couldn't confirm whether the payment was saved. Save again to retry: it won't be recorded twice."
export const PAYMENT_KEY_CONFLICT_MESSAGE =
  'A payment from your earlier attempt was already recorded. Check the payment history before recording another.'
export const RECEIPT_ERROR_MESSAGE = 'Unable to get the receipt. Please try again.'
export const RECEIPT_UNCONFIRMED_MESSAGE =
  "We couldn't confirm whether the receipt was issued. Try again: it won't issue a second one."

// No response, a server error or a response we couldn't read: the request may have been
// carried out anyway. Retrying with the same idempotency key is safe; a new key isn't.
const UNCERTAIN_KINDS = new Set(['network', 'unavailable', 'invalid-response', 'unknown'])

export function isUncertainFailure(error: unknown): boolean {
  return UNCERTAIN_KINDS.has(error instanceof ApiError ? error.kind : 'unknown')
}

export function entryLoadErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'

  switch (kind) {
    case 'network':
      return "Couldn't reach the server. Check your connection and try again."
    case 'unavailable':
      return 'Rent entries are unavailable right now. Please try again shortly.'
    case 'unauthorized':
      return "Your sign-in couldn't be verified. Log out and sign in again."
    case 'rate-limited':
      return RATE_LIMITED_MESSAGE
    default:
      return ENTRIES_LOAD_ERROR_MESSAGE
  }
}

export function paymentsLoadErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'

  switch (kind) {
    case 'network':
      return "Couldn't reach the server. Check your connection and try again."
    case 'unavailable':
      return 'Payments are unavailable right now. Please try again shortly.'
    case 'unauthorized':
      return "Your sign-in couldn't be verified. Log out and sign in again."
    case 'rate-limited':
      return RATE_LIMITED_MESSAGE
    default:
      return PAYMENTS_LOAD_ERROR_MESSAGE
  }
}

// The backend's first message, e.g. "The paid date can't be in the future."
function firstFieldError(error: ApiError): string | null {
  return Object.values(error.fieldErrors)[0] ?? null
}

// A failed save, with what the page needs to say about it. existingEntry: the bill already
// saved for that month, so the page can link to it rather than invite another submission.
// uncertain: the save may have gone through (no response): the next attempt must reuse the
// same idempotency key, so a retry returns that bill instead of saving another.
export class EntrySaveError extends Error {
  constructor(
    message: string,
    readonly existingEntry: RentEntry | null = null,
    readonly uncertain = false,
  ) {
    super(message)
    this.name = 'EntrySaveError'
  }
}

// A failed payment. uncertain: as for EntrySaveError, the next attempt must reuse the key.
export class PaymentSaveError extends Error {
  constructor(
    message: string,
    readonly uncertain = false,
  ) {
    super(message)
    this.name = 'PaymentSaveError'
  }
}

// A receipt that couldn't be issued or loaded. The payment is never affected. uncertain: there
// was no usable response; trying again is safe (the payment has at most one receipt).
export class ReceiptError extends Error {
  constructor(
    message: string,
    readonly uncertain = false,
  ) {
    super(message)
    this.name = 'ReceiptError'
  }
}

// notFound: what's missing on a 404, the payment unless said otherwise.
function receiptErrorMessage(
  err: unknown,
  notFound = "This payment can't be found. It may no longer be available.",
): string {
  const problem = receiptConfigurationProblem(err)
  if (problem) return problem
  const kind = err instanceof ApiError ? err.kind : 'unknown'
  if (kind === 'forbidden') return "You don't have permission to issue receipts for this property."
  if (kind === 'not-found') return notFound
  if (kind === 'rate-limited') return RATE_LIMITED_MESSAGE
  if (kind === 'unauthorized')
    return "Your sign-in couldn't be verified. Log out and sign in again."
  return RECEIPT_ERROR_MESSAGE
}

// One page of one tenant's bills, as the history page shows it.
export interface EntryHistory {
  tenantId: string | null
  year: string | null
  paymentStatus: PaymentStatus | null
  page: number
  entries: RentEntry[]
  count: number
  hasNext: boolean
  hasPrevious: boolean
  status: EntryListStatus
  error: string | null
}

// One bill's payments, newest first, as the backend returns them.
export interface EntryPayments {
  status: EntryListStatus
  payments: Payment[]
  error: string | null
}

// A tenant's newest bill and how many they have, for the dashboard.
export interface EntrySummary {
  status: EntryListStatus
  latest: RentEntry | null
  count: number
  error: string | null
}

function emptyHistory(): EntryHistory {
  return {
    tenantId: null,
    year: null,
    paymentStatus: null,
    page: 1,
    entries: [],
    count: 0,
    hasNext: false,
    hasPrevious: false,
    status: 'idle',
    error: null,
  }
}

// Bills (rent entries) of the selected property, from the backend. Nothing is saved on this
// device: a bill shows as saved only once the backend has returned it, and its figures are
// the backend's.
export const useRentEntryStore = defineStore('rentEntry', () => {
  const accessStore = useAccessStore()

  // Every bill loaded for this property, by id: from lists, details and saves.
  const entriesById = ref<Record<string, RentEntry>>({})
  const history = ref<EntryHistory>(emptyHistory())
  const summaries = ref<Record<string, EntrySummary>>({})
  // By bill id.
  const payments = ref<Record<string, EntryPayments>>({})

  // Responses are discarded once reset() runs (another property, or logout), a history
  // response once a newer history request starts, and a tenant's summary response once a newer
  // summary request for that tenant starts or a bill is saved for them (it predates the bill).
  let generation = 0
  let historySeq = 0
  const summarySeq = new Map<string, number>()
  const paymentsSeq = new Map<string, number>()
  // The idempotency key of each bill's pending payment, kept here rather than on the page so
  // leaving the page after an uncertain save (no response) never loses it: the next attempt,
  // whenever it comes, is a retry the backend recognises.
  const paymentKeys = new Map<string, string>()
  // Issued receipts by payment id. Snapshots never change, so one loaded is reused.
  const receipts = new Map<string, PaymentReceipt>()

  function nextSummarySeq(tenantId: string): number {
    const seq = (summarySeq.get(tenantId) ?? 0) + 1
    summarySeq.set(tenantId, seq)
    return seq
  }

  function remember(entries: RentEntry[]) {
    const next = { ...entriesById.value }
    for (const entry of entries) next[entry.id] = entry
    entriesById.value = next
  }

  // A bill's new figures (after a payment) wherever it's shown: by id, in the history page and
  // as the dashboard's latest bill.
  function update(entry: RentEntry) {
    remember([entry])
    if (history.value.entries.some((item) => item.id === entry.id)) {
      history.value = {
        ...history.value,
        entries: history.value.entries.map((item) => (item.id === entry.id ? entry : item)),
      }
    }
    const summary = summaries.value[entry.tenantId]
    if (summary?.latest?.id === entry.id) {
      summaries.value = { ...summaries.value, [entry.tenantId]: { ...summary, latest: entry } }
    }
  }

  function requireProperty(): string {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) throw new Error('Choose a property first.')
    return propertyId
  }

  // One page of a tenant's bills, newest first, filtered by the backend. Also the history
  // page's Retry.
  async function loadHistory(
    tenantId: string,
    options: { year?: string | null; paymentStatus?: PaymentStatus | null; page?: number },
  ) {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return

    const seq = ++historySeq
    const gen = generation
    const year = options.year ?? null
    const paymentStatus = options.paymentStatus ?? null
    const page = options.page ?? 1
    history.value = { ...emptyHistory(), tenantId, year, paymentStatus, page, status: 'loading' }

    try {
      const result = await rentEntryService.getEntries(propertyId, tenantId, {
        year: year ?? undefined,
        paymentStatus: paymentStatus ?? undefined,
        page,
      })
      if (seq !== historySeq || gen !== generation) return

      remember(result.entries)
      history.value = {
        tenantId,
        year,
        paymentStatus,
        page: result.page,
        entries: result.entries,
        count: result.count,
        hasNext: result.hasNext,
        hasPrevious: result.hasPrevious,
        status: 'ready',
        error: null,
      }
    } catch (err) {
      if (seq !== historySeq || gen !== generation) return
      history.value = {
        ...emptyHistory(),
        tenantId,
        year,
        paymentStatus,
        page,
        status: 'error',
        error: entryLoadErrorMessage(err),
      }
    }
  }

  // The tenant's newest bill and bill count (the first page is newest first). Also Retry.
  async function loadSummary(tenantId: string) {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return

    const gen = generation
    const seq = nextSummarySeq(tenantId)
    const isCurrent = () => gen === generation && summarySeq.get(tenantId) === seq
    const previous = summaries.value[tenantId]
    // Keeps what's shown while it refreshes, so the card doesn't flash.
    summaries.value = {
      ...summaries.value,
      [tenantId]: {
        status: 'loading',
        latest: previous?.latest ?? null,
        count: previous?.count ?? 0,
        error: null,
      },
    }

    let summary: EntrySummary
    try {
      const result = await rentEntryService.getEntries(propertyId, tenantId)
      if (!isCurrent()) return
      remember(result.entries)
      summary = {
        status: 'ready',
        latest: result.entries[0] ?? null,
        count: result.count,
        error: null,
      }
    } catch (err) {
      if (!isCurrent()) return
      summary = { status: 'error', latest: null, count: 0, error: entryLoadErrorMessage(err) }
    }
    summaries.value = { ...summaries.value, [tenantId]: summary }
  }

  // Matches both ids, so a bill never shows under another tenant's URL.
  function getEntry(tenantId: string, entryId: string): RentEntry | null {
    const entry = entriesById.value[entryId]
    return entry && entry.tenantId === tenantId ? entry : null
  }

  // One bill, for pages opened by URL: from what's loaded, or the detail API. null when the
  // tenant has no such bill; other failures throw (an outage isn't "not found").
  // refresh: ask the backend even when it's loaded, e.g. for a balance that has changed.
  async function loadEntry(
    tenantId: string,
    entryId: string,
    { refresh = false } = {},
  ): Promise<RentEntry | null> {
    const cached = getEntry(tenantId, entryId)
    if (cached && !refresh) return cached

    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return null

    const gen = generation
    try {
      const entry = await rentEntryService.getEntry(propertyId, tenantId, entryId)
      if (gen === generation) update(entry)
      return entry
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'not-found') return null
      throw err
    }
  }

  // The bill saved for that month, if any. Never throws: null when it can't be checked.
  async function findSavedEntry(propertyId: string, tenantId: string, billingMonth: string) {
    try {
      const result = await rentEntryService.getEntries(propertyId, tenantId, { billingMonth })
      return { checked: true, entry: result.entries[0] ?? null }
    } catch {
      return { checked: false, entry: null }
    }
  }

  // Saves a new bill, and the payment received with it if any (the backend saves both or
  // neither). Only the backend's response counts as saved: it's added to state and returned
  // (with the backend's rate and totals), and on any failure nothing changes, so the page keeps
  // the form. Throws EntrySaveError with a message for the page.
  // idempotencyKey: one per intended bill. Reuse it after an uncertain failure (the error says
  // so), so a retry returns the bill if the first attempt saved it; use a new one otherwise.
  async function addEntry(
    submission: NewRentEntrySubmission,
    idempotencyKey: string,
  ): Promise<RentEntry> {
    const { entry: input, initialPayment } = submission

    if (
      Object.keys(validateRentEntryInput(input)).length > 0 ||
      (initialPayment && Object.keys(validatePaymentDraft(initialPayment)).length > 0)
    ) {
      throw new EntrySaveError('This entry is not valid. Check the form and try again.')
    }

    const propertyId = requireProperty()
    const gen = generation

    try {
      const entry = await rentEntryService.createEntry(
        propertyId,
        input.tenantId,
        submission,
        idempotencyKey,
      )
      if (gen === generation) {
        remember([entry])
        // The dashboard reloads it with this bill included. A summary request still in flight
        // predates the bill, so its response is discarded too.
        nextSummarySeq(input.tenantId)
        const next = { ...summaries.value }
        delete next[input.tenantId]
        summaries.value = next
      }
      return entry
    } catch (err) {
      const kind = err instanceof ApiError ? err.kind : 'unknown'
      const code = err instanceof ApiError ? err.code : null

      if (isUncertainFailure(err)) {
        throw new EntrySaveError(SAVE_UNCONFIRMED_MESSAGE, null, true)
      }

      if (code === 'payment_exceeds_outstanding') {
        // The bill came to less than the form previewed (e.g. the rate changed meanwhile).
        const total = outstandingFromConflict(err)
        throw new EntrySaveError(
          total === null
            ? 'The payment is more than the bill. Check the amount and try again.'
            : `The payment is more than the bill's total due of ${formatINR(total)}. Check the amount and try again.`,
        )
      }

      if (kind === 'conflict') {
        // A duplicate month, or this key's earlier attempt saved a bill with other details:
        // either way, link the bill that's saved for the month.
        const { entry } = await findSavedEntry(propertyId, input.tenantId, input.billingMonth)
        throw new EntrySaveError(
          code === 'idempotency_conflict' ? ENTRY_KEY_CONFLICT_MESSAGE : DUPLICATE_ENTRY_MESSAGE,
          entry,
        )
      }

      if (err instanceof ApiError && kind === 'invalid-request') {
        // The backend's own message, e.g. a month outside the tenancy.
        throw new EntrySaveError(
          firstFieldError(err) ?? 'This entry is not valid. Check the form and try again.',
        )
      }

      // Refused before anything was saved, so trying again later is safe.
      if (kind === 'rate-limited') {
        throw new EntrySaveError(`${RATE_LIMITED_MESSAGE} Your form has been kept.`)
      }
      if (kind === 'unauthorized') {
        throw new EntrySaveError("Your sign-in couldn't be verified. Log out and sign in again.")
      }
      if (kind === 'forbidden') {
        throw new EntrySaveError("You don't have permission to add entries for this property.")
      }

      throw new EntrySaveError(SAVE_ERROR_MESSAGE)
    }
  }

  // A bill's payments, newest first. Also Retry.
  async function loadPayments(tenantId: string, entryId: string) {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return

    const gen = generation
    const seq = (paymentsSeq.get(entryId) ?? 0) + 1
    paymentsSeq.set(entryId, seq)
    const isCurrent = () => gen === generation && paymentsSeq.get(entryId) === seq
    const previous = payments.value[entryId]
    // Keeps the list shown while it refreshes after a payment.
    payments.value = {
      ...payments.value,
      [entryId]: { status: 'loading', payments: previous?.payments ?? [], error: null },
    }

    let next: EntryPayments
    try {
      const result = await paymentService.getPayments(propertyId, tenantId, entryId)
      if (!isCurrent()) return
      next = { status: 'ready', payments: result, error: null }
    } catch (err) {
      if (!isCurrent()) return
      next = { status: 'error', payments: [], error: paymentsLoadErrorMessage(err) }
    }
    payments.value = { ...payments.value, [entryId]: next }
  }

  // Records a payment against a bill. The backend locks the bill and checks the balance; its
  // response (the payment and the bill's new figures) is what's shown, and the payment history
  // is reloaded. On failure nothing changes: throws PaymentSaveError with a message.
  // idempotencyKey: one per intended payment, reused after an uncertain failure (see
  // PaymentSaveError.uncertain) so the money is never recorded twice.
  async function addPayment(
    tenantId: string,
    input: PaymentInput,
    idempotencyKey: string,
  ): Promise<RecordedPayment> {
    if (Object.keys(validatePaymentInput(input)).length > 0) {
      throw new PaymentSaveError('This payment is not valid. Check the form and try again.')
    }

    const propertyId = requireProperty()
    const gen = generation

    try {
      const recorded = await paymentService.recordPayment(
        propertyId,
        tenantId,
        input,
        idempotencyKey,
      )
      if (gen === generation) {
        update(recorded.entry)
        void loadPayments(tenantId, input.entryId)
      }
      return recorded
    } catch (err) {
      const kind = err instanceof ApiError ? err.kind : 'unknown'
      const code = err instanceof ApiError ? err.code : null

      if (isUncertainFailure(err)) {
        throw new PaymentSaveError(PAYMENT_UNCONFIRMED_MESSAGE, true)
      }

      if (code === 'payment_exceeds_outstanding') {
        // Someone else recorded a payment meanwhile: show the current balance.
        void refreshAfterConflict(tenantId, input.entryId, gen)
        const outstanding = outstandingFromConflict(err)
        throw new PaymentSaveError(
          outstanding === null
            ? 'This payment is more than the outstanding amount.'
            : outstanding <= 0
              ? 'This bill is already fully paid.'
              : `Amount cannot exceed the outstanding ${formatINR(outstanding)}.`,
        )
      }

      if (code === 'idempotency_conflict') {
        // An earlier attempt with this key was recorded (with other details): show it.
        void refreshAfterConflict(tenantId, input.entryId, gen)
        throw new PaymentSaveError(PAYMENT_KEY_CONFLICT_MESSAGE)
      }

      if (err instanceof ApiError && kind === 'invalid-request') {
        throw new PaymentSaveError(
          firstFieldError(err) ?? 'This payment is not valid. Check the form and try again.',
        )
      }
      if (kind === 'not-found') {
        throw new PaymentSaveError("This entry can't be found. It may no longer be available.")
      }
      // Refused before anything was recorded, so trying again later is safe.
      if (kind === 'rate-limited') {
        throw new PaymentSaveError(`${RATE_LIMITED_MESSAGE} Your payment details have been kept.`)
      }
      if (kind === 'unauthorized') {
        throw new PaymentSaveError("Your sign-in couldn't be verified. Log out and sign in again.")
      }
      if (kind === 'forbidden') {
        throw new PaymentSaveError(
          "You don't have permission to record payments for this property.",
        )
      }

      throw new PaymentSaveError(PAYMENT_SAVE_ERROR_MESSAGE)
    }
  }

  // The key for the next attempt at a payment against this bill: the pending one if the last
  // attempt was uncertain, otherwise a new one.
  function paymentKeyFor(entryId: string): string {
    let key = paymentKeys.get(entryId)
    if (!key) {
      key = crypto.randomUUID()
      paymentKeys.set(entryId, key)
    }
    return key
  }

  // After a success or a definite rejection: the next payment is a new one.
  function forgetPaymentKey(entryId: string) {
    paymentKeys.delete(entryId)
  }

  // The payment's receipt from Django: its saved snapshot if one was issued, otherwise issued
  // now (and the payment history shows it has one). Issuing again, or retrying after a lost
  // response, returns the same receipt. Throws ReceiptError; the payment is never changed.
  async function getReceipt(tenantId: string, payment: Payment): Promise<PaymentReceipt> {
    const cached = receipts.get(payment.id)
    if (cached) return cached

    const propertyId = requireProperty()
    const gen = generation
    let receipt: PaymentReceipt
    try {
      receipt = payment.receipt
        ? await receiptService.getReceipt(propertyId, tenantId, payment.entryId, payment.id)
        : (await receiptService.issueReceipt(propertyId, tenantId, payment.entryId, payment.id))
            .receipt
    } catch (err) {
      if (isUncertainFailure(err)) {
        // Only issuing can leave it unknown whether a receipt now exists; loading one can't.
        if (payment.receipt) throw new ReceiptError(RECEIPT_ERROR_MESSAGE)
        throw new ReceiptError(RECEIPT_UNCONFIRMED_MESSAGE, true)
      }
      throw new ReceiptError(receiptErrorMessage(err))
    }

    if (gen === generation) {
      receipts.set(payment.id, receipt)
      markReceiptIssued(payment.entryId, payment.id, receipt)
    }
    return receipt
  }

  // The receipt for the bill's most recent payment (newest paid date, then newest recorded),
  // issued if it has none: for buttons that offer a bill's receipt without listing its
  // payments. Always loads the bill's payments first, never a loaded list, which may predate a
  // payment someone else recorded; fails if they can't be loaded. Throws ReceiptError.
  async function getLatestReceipt(tenantId: string, entryId: string): Promise<PaymentReceipt> {
    const propertyId = requireProperty()
    const gen = generation
    const startSeq = paymentsSeq.get(entryId) ?? 0
    let list: Payment[]
    try {
      list = await paymentService.getPayments(propertyId, tenantId, entryId)
    } catch (err) {
      throw new ReceiptError(
        isUncertainFailure(err)
          ? RECEIPT_ERROR_MESSAGE
          : receiptErrorMessage(err, "This entry can't be found. It may no longer be available."),
      )
    }
    // Shown unless a load started since; one under way when this began may predate the newest
    // payment, so it's superseded (its result ignored). After a failure it's left to finish.
    if (gen === generation && (paymentsSeq.get(entryId) ?? 0) === startSeq) {
      paymentsSeq.set(entryId, startSeq + 1)
      payments.value = {
        ...payments.value,
        [entryId]: { status: 'ready', payments: list, error: null },
      }
    }

    const latest = list[0]
    if (!latest) throw new ReceiptError('No payments have been recorded for this entry yet.')
    return getReceipt(tenantId, latest)
  }

  function markReceiptIssued(entryId: string, paymentId: string, receipt: PaymentReceipt) {
    const current = payments.value[entryId]
    if (!current) return
    payments.value = {
      ...payments.value,
      [entryId]: {
        ...current,
        payments: current.payments.map((item) =>
          item.id === paymentId && !item.receipt
            ? { ...item, receipt: { id: receipt.id, reference: receipt.reference } }
            : item,
        ),
      },
    }
  }

  async function refreshAfterConflict(tenantId: string, entryId: string, gen: number) {
    if (gen !== generation) return
    await Promise.allSettled([
      loadEntry(tenantId, entryId, { refresh: true }),
      loadPayments(tenantId, entryId),
    ])
  }

  // Forget the previous property's (or user's) bills, and ignore their pending responses.
  function reset() {
    generation++
    historySeq++
    summarySeq.clear()
    paymentsSeq.clear()
    paymentKeys.clear()
    receipts.clear()
    entriesById.value = {}
    history.value = emptyHistory()
    summaries.value = {}
    payments.value = {}
  }

  // Switching property, logging out and losing access all change the selected property.
  watch(
    () => accessStore.selectedPropertyId,
    (next, previous) => {
      if (next !== previous) reset()
    },
    { flush: 'sync' },
  )

  return {
    history,
    summaries,
    payments,
    loadHistory,
    loadSummary,
    getEntry,
    loadEntry,
    addEntry,
    loadPayments,
    addPayment,
    paymentKeyFor,
    forgetPaymentKey,
    getReceipt,
    getLatestReceipt,
    reset,
  }
})
