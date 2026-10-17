import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, RATE_LIMITED_MESSAGE } from '@/services/apiError'
import { dashboardService } from '@/services/dashboard.service'
import { useAccessStore } from '@/stores/access'
import type { OverdueBills, OverdueFilters } from '@/types/dashboard'

export type OverdueLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export const OVERDUE_LOAD_ERROR_MESSAGE = 'Unable to load overdue bills. Please try again.'

export function overdueErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'
  switch (kind) {
    case 'network':
      return "Couldn't reach the server. Check your connection and try again."
    case 'unavailable':
      return 'Overdue bills are unavailable right now. Please try again shortly.'
    case 'unauthorized':
      return "Your sign-in couldn't be verified. Log out and sign in again."
    case 'rate-limited':
      return RATE_LIMITED_MESSAGE
    default:
      return OVERDUE_LOAD_ERROR_MESSAGE
  }
}

const NO_FILTERS: OverdueFilters = { propertyId: null, month: null, search: '' }

// Overdue bills across every property the user has, for the chosen filters. A refresh keeps
// what's shown until the new list arrives, and a failed one keeps it, with when it was loaded.
// A filter change replaces the list: until it arrives (or if it fails) the old filters' list is
// never shown as this one's. Nothing here is ever an empty list standing in for a failed load.
export const useOverdueStore = defineStore('overdue', () => {
  const accessStore = useAccessStore()

  const bills = ref<OverdueBills | null>(null)

  // The first load: 'loading' and 'error' only until it has loaded once.
  const status = ref<OverdueLoadStatus>('idle')
  const error = ref<string | null>(null)
  // A refresh of a list already shown, and why the last one failed (the list stays).
  const refreshing = ref(false)
  const refreshError = ref<string | null>(null)
  // When the list shown was loaded (Date.now()), for "Updated 30 seconds ago".
  const loadedAt = ref<number | null>(null)

  const filters = ref<OverdueFilters>({ ...NO_FILTERS })
  // The list for new filters: loading, or failed (with why), until it arrives.
  const listStatus = ref<OverdueLoadStatus>('idle')
  const listError = ref<string | null>(null)

  const loaded = computed(() => loadedAt.value !== null)
  const filtered = computed(
    () =>
      filters.value.propertyId !== null ||
      filters.value.month !== null ||
      filters.value.search.trim() !== '',
  )

  // Only the newest request may change state; a filter change supersedes a refresh.
  let seq = 0
  let inFlight: Promise<void> | null = null

  function load(): Promise<void> {
    const at = ++seq
    refreshing.value = true
    if (!loaded.value) {
      status.value = 'loading'
      error.value = null
    }

    const run = (async () => {
      try {
        const next = await dashboardService.getOverdueBills({ ...filters.value })
        if (at !== seq) return
        bills.value = next
        loadedAt.value = Date.now()
        status.value = 'ready'
        error.value = null
        refreshError.value = null
        listStatus.value = 'ready'
        listError.value = null
      } catch (err) {
        if (at !== seq) return
        const message = overdueErrorMessage(err)
        if (!loaded.value) {
          status.value = 'error'
          error.value = message
        } else if (listStatus.value !== 'ready') {
          // The list shown is for other filters: say this one failed instead.
          listStatus.value = 'error'
          listError.value = message
        } else {
          refreshError.value = message
        }
      } finally {
        if (at === seq) {
          refreshing.value = false
          inFlight = null
        }
      }
    })()
    inFlight = run
    return run
  }

  // The first load, Refresh and Retry. While one is running, another waits for it.
  function refresh(): Promise<void> {
    return inFlight ?? load()
  }

  function setFilters(next: Partial<OverdueFilters>): Promise<void> {
    const merged = { ...filters.value, ...next }
    const current = filters.value
    if (
      merged.propertyId === current.propertyId &&
      merged.month === current.month &&
      merged.search.trim() === current.search.trim()
    ) {
      filters.value = merged
      return inFlight ?? Promise.resolve()
    }
    filters.value = merged
    if (loaded.value) {
      listStatus.value = 'loading'
      listError.value = null
    }
    return load()
  }

  function clearFilters(): Promise<void> {
    return setFilters({ ...NO_FILTERS })
  }

  function reset() {
    seq++
    inFlight = null
    bills.value = null
    status.value = 'idle'
    error.value = null
    refreshing.value = false
    refreshError.value = null
    loadedAt.value = null
    filters.value = { ...NO_FILTERS }
    listStatus.value = 'idle'
    listError.value = null
  }

  // Another person signed in (or nobody): nothing of the last one's may show. Switching the
  // selected property keeps the list: it spans them all.
  watch(
    () => accessStore.identity?.id ?? null,
    (next, previous) => {
      if (next !== previous) reset()
    },
    { flush: 'sync' },
  )

  return {
    bills,
    status,
    error,
    refreshing,
    refreshError,
    loadedAt,
    loaded,
    filters,
    filtered,
    listStatus,
    listError,
    refresh,
    setFilters,
    clearFilters,
    reset,
  }
})
