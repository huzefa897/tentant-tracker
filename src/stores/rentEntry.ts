import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError } from '@/services/apiError'
import { rentEntryService } from '@/services/rentEntry.service'
import { useAccessStore } from '@/stores/access'
import type { NewRentEntrySubmission, RentEntry } from '@/types/rentEntry'
import { formatMonthValue } from '@/utils/date'
import { validateRentEntryInput } from '@/utils/rentEntryValidation'

export type EntryListStatus = 'idle' | 'loading' | 'ready' | 'error'

export const ENTRIES_LOAD_ERROR_MESSAGE = 'Unable to load rent entries. Please try again.'
export const SAVE_ERROR_MESSAGE =
  'Unable to save the entry. Your form has been kept. Please try again.'
export const DUPLICATE_ENTRY_MESSAGE = 'An entry already exists for this tenant and billing month.'
export const PAYMENTS_UNAVAILABLE_MESSAGE =
  "Payments can't be recorded with a bill yet. Save the bill without a payment."
export const SAVE_UNCONFIRMED_MESSAGE =
  "We couldn't confirm whether the entry was saved. Check Previous Entries before trying again."

export function entryLoadErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'

  switch (kind) {
    case 'network':
      return "Couldn't reach the server. Check your connection and try again."
    case 'unavailable':
      return 'Rent entries are unavailable right now. Please try again shortly.'
    case 'unauthorized':
      return "Your sign-in couldn't be verified. Log out and sign in again."
    default:
      return ENTRIES_LOAD_ERROR_MESSAGE
  }
}

// A failed save, with what the page needs to say about it. existingEntry: the bill that's now
// saved for that month (a duplicate, or a save that went through although its response was
// lost), so the page can link to it rather than invite another submission.
export class EntrySaveError extends Error {
  constructor(
    message: string,
    readonly existingEntry: RentEntry | null = null,
  ) {
    super(message)
    this.name = 'EntrySaveError'
  }
}

// One page of one tenant's bills, as the history page shows it.
export interface EntryHistory {
  tenantId: string | null
  year: string | null
  page: number
  entries: RentEntry[]
  count: number
  hasNext: boolean
  hasPrevious: boolean
  status: EntryListStatus
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

  // Responses are discarded once reset() runs (another property, or logout), a history
  // response once a newer history request starts, and a tenant's summary response once a newer
  // summary request for that tenant starts or a bill is saved for them (it predates the bill).
  let generation = 0
  let historySeq = 0
  const summarySeq = new Map<string, number>()

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

  function requireProperty(): string {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) throw new Error('Choose a property first.')
    return propertyId
  }

  // One page of a tenant's bills, newest first. Also the history page's Retry.
  async function loadHistory(tenantId: string, options: { year?: string | null; page?: number }) {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return

    const seq = ++historySeq
    const gen = generation
    const year = options.year ?? null
    const page = options.page ?? 1
    history.value = { ...emptyHistory(), tenantId, year, page, status: 'loading' }

    try {
      const result = await rentEntryService.getEntries(propertyId, tenantId, {
        year: year ?? undefined,
        page,
      })
      if (seq !== historySeq || gen !== generation) return

      remember(result.entries)
      history.value = {
        tenantId,
        year,
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
  async function loadEntry(tenantId: string, entryId: string): Promise<RentEntry | null> {
    const cached = getEntry(tenantId, entryId)
    if (cached) return cached

    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return null

    const gen = generation
    try {
      const entry = await rentEntryService.getEntry(propertyId, tenantId, entryId)
      if (gen === generation) remember([entry])
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

  // Saves a new bill. Only the backend's response counts as saved: it's added to state and
  // returned (with the backend's rate and totals), and on any failure nothing changes, so the
  // page keeps the form. Throws EntrySaveError with a message for the page.
  async function addEntry(submission: NewRentEntrySubmission): Promise<RentEntry> {
    const { entry: input, initialPayment } = submission

    // Payments move to the backend in BE Phase 5. Refused rather than dropped: a payment the
    // user entered must never disappear silently.
    if (initialPayment) throw new EntrySaveError(PAYMENTS_UNAVAILABLE_MESSAGE)

    if (Object.keys(validateRentEntryInput(input)).length > 0) {
      throw new EntrySaveError('This entry is not valid. Check the form and try again.')
    }

    const propertyId = requireProperty()
    const gen = generation

    try {
      const entry = await rentEntryService.createEntry(propertyId, input.tenantId, input)
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
      const month = formatMonthValue(input.billingMonth)

      if (kind === 'conflict') {
        const { entry } = await findSavedEntry(propertyId, input.tenantId, input.billingMonth)
        throw new EntrySaveError(DUPLICATE_ENTRY_MESSAGE, entry)
      }

      if (err instanceof ApiError && kind === 'invalid-request') {
        // The backend's own message, e.g. a month outside the tenancy.
        const first = Object.values(err.fieldErrors)[0]
        throw new EntrySaveError(first ?? 'This entry is not valid. Check the form and try again.')
      }

      // No response (e.g. a timeout) or a server error: the bill may have been saved anyway.
      // Check before inviting another submission.
      if (kind === 'network' || kind === 'unavailable') {
        const { checked, entry } = await findSavedEntry(
          propertyId,
          input.tenantId,
          input.billingMonth,
        )
        if (entry) {
          throw new EntrySaveError(
            `${month} now has a saved entry. Open it to check it before adding another.`,
            entry,
          )
        }
        if (!checked) throw new EntrySaveError(SAVE_UNCONFIRMED_MESSAGE)
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

  // Forget the previous property's (or user's) bills, and ignore their pending responses.
  function reset() {
    generation++
    historySeq++
    summarySeq.clear()
    entriesById.value = {}
    history.value = emptyHistory()
    summaries.value = {}
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
    loadHistory,
    loadSummary,
    getEntry,
    loadEntry,
    addEntry,
    reset,
  }
})
