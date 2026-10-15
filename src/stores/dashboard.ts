import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, RATE_LIMITED_MESSAGE } from '@/services/apiError'
import { dashboardService } from '@/services/dashboard.service'
import { useAccessStore } from '@/stores/access'
import type {
  DashboardSummary,
  DueFilter,
  MissingBills,
  PendingTenancyPage,
} from '@/types/dashboard'

export type DashboardLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export const DASHBOARD_LOAD_ERROR_MESSAGE = 'Unable to load pending payments. Please try again.'

export function dashboardErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'

  switch (kind) {
    case 'network':
      return "Couldn't reach the server. Check your connection and try again."
    case 'unavailable':
      return 'Pending payments are unavailable right now. Please try again shortly.'
    case 'unauthorized':
      return "Your sign-in couldn't be verified. Log out and sign in again."
    case 'rate-limited':
      return RATE_LIMITED_MESSAGE
    default:
      return DASHBOARD_LOAD_ERROR_MESSAGE
  }
}

// The selected property's dashboard: its totals, the tenancies that owe money (one page, for
// one due filter) and the tenancies with a missing bill for one month. A refresh loads all three
// together and replaces them only when all three arrive, so the screen never mixes two moments;
// a failed refresh keeps what was shown, with when it was loaded. Nothing here is ever a zero or
// an empty list standing in for a failed load.
export const useDashboardStore = defineStore('dashboard', () => {
  const accessStore = useAccessStore()

  const summary = ref<DashboardSummary | null>(null)
  const pending = ref<PendingTenancyPage | null>(null)
  const missing = ref<MissingBills | null>(null)

  // The whole dashboard: 'loading' and 'error' only until it has loaded once.
  const status = ref<DashboardLoadStatus>('idle')
  const error = ref<string | null>(null)
  // A refresh of a dashboard already shown, and why the last one failed (its figures stay).
  const refreshing = ref(false)
  const refreshError = ref<string | null>(null)
  // When everything shown was loaded (Date.now()), for "Updated 30 seconds ago".
  const loadedAt = ref<number | null>(null)

  // The list's filter and page, reloaded on their own: the summary never changes with them.
  const dueFilter = ref<DueFilter>('all')
  const page = ref(1)
  const pendingStatus = ref<DashboardLoadStatus>('idle')
  const pendingError = ref<string | null>(null)

  // null: the month the backend picks (last month when postpaid, this month when prepaid).
  const missingMonth = ref<string | null>(null)
  const missingStatus = ref<DashboardLoadStatus>('idle')
  const missingError = ref<string | null>(null)

  const loaded = computed(() => loadedAt.value !== null)

  // Each request gets a number per part; only the newest may change state. reset() bumps them
  // all, discarding responses for the old property.
  let refreshSeq = 0
  let pendingSeq = 0
  let missingSeq = 0
  let inFlight: Promise<void> | null = null

  // Everything, together. While one is running, another call waits for it rather than sending
  // the requests again. Also the first load and Retry.
  function refresh(): Promise<void> {
    if (inFlight) return inFlight
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return Promise.resolve()

    const seq = ++refreshSeq
    const pendingAt = ++pendingSeq
    const missingAt = ++missingSeq
    refreshing.value = true
    if (!loaded.value) {
      status.value = 'loading'
      error.value = null
    }

    const run = (async () => {
      try {
        const [nextSummary, nextPending, nextMissing] = await Promise.all([
          dashboardService.getSummary(propertyId),
          dashboardService.getPendingTenancies(propertyId, {
            due: dueFilter.value,
            page: page.value,
          }),
          dashboardService.getMissingBills(propertyId, missingMonth.value),
        ])
        if (seq !== refreshSeq) return
        summary.value = nextSummary
        // A filter, page or month changed while this ran: its own reload wins for that part.
        if (pendingAt === pendingSeq) {
          pending.value = nextPending
          pendingStatus.value = 'ready'
          pendingError.value = null
        }
        if (missingAt === missingSeq) {
          missing.value = nextMissing
          missingStatus.value = 'ready'
          missingError.value = null
        }
        loadedAt.value = Date.now()
        status.value = 'ready'
        error.value = null
        refreshError.value = null
      } catch (err) {
        if (seq !== refreshSeq) return
        if (loaded.value) {
          refreshError.value = dashboardErrorMessage(err)
        } else {
          status.value = 'error'
          error.value = dashboardErrorMessage(err)
        }
      } finally {
        if (seq === refreshSeq) {
          refreshing.value = false
          inFlight = null
        }
      }
    })()
    inFlight = run
    return run
  }

  async function loadPending() {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return

    const seq = ++pendingSeq
    pendingStatus.value = 'loading'
    pendingError.value = null
    try {
      const result = await dashboardService.getPendingTenancies(propertyId, {
        due: dueFilter.value,
        page: page.value,
      })
      if (seq !== pendingSeq) return
      pending.value = result
      pendingStatus.value = 'ready'
    } catch (err) {
      if (seq !== pendingSeq) return
      pendingStatus.value = 'error'
      pendingError.value = dashboardErrorMessage(err)
    }
  }

  function setDueFilter(next: DueFilter) {
    if (next === dueFilter.value) return
    dueFilter.value = next
    page.value = 1
    void loadPending()
  }

  function goToPage(next: number) {
    page.value = next
    void loadPending()
  }

  // Also the list's Retry.
  function retryPending() {
    void loadPending()
  }

  async function loadMissing() {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return

    const seq = ++missingSeq
    missingStatus.value = 'loading'
    missingError.value = null
    try {
      const result = await dashboardService.getMissingBills(propertyId, missingMonth.value)
      if (seq !== missingSeq) return
      missing.value = result
      missingStatus.value = 'ready'
    } catch (err) {
      if (seq !== missingSeq) return
      missingStatus.value = 'error'
      missingError.value = dashboardErrorMessage(err)
    }
  }

  function setMissingMonth(month: string) {
    missingMonth.value = month
    void loadMissing()
  }

  function retryMissing() {
    void loadMissing()
  }

  function reset() {
    refreshSeq++
    pendingSeq++
    missingSeq++
    inFlight = null
    summary.value = null
    pending.value = null
    missing.value = null
    status.value = 'idle'
    error.value = null
    refreshing.value = false
    refreshError.value = null
    loadedAt.value = null
    dueFilter.value = 'all'
    page.value = 1
    pendingStatus.value = 'idle'
    pendingError.value = null
    missingMonth.value = null
    missingStatus.value = 'idle'
    missingError.value = null
  }

  // Another property (or logout): nothing of the previous one's may show, even for a moment.
  watch(
    () => accessStore.selectedPropertyId,
    (next, previous) => {
      if (next !== previous) reset()
    },
    { flush: 'sync' },
  )

  return {
    summary,
    pending,
    missing,
    status,
    error,
    refreshing,
    refreshError,
    loadedAt,
    loaded,
    dueFilter,
    page,
    pendingStatus,
    pendingError,
    missingMonth,
    missingStatus,
    missingError,
    refresh,
    setDueFilter,
    goToPage,
    retryPending,
    setMissingMonth,
    retryMissing,
    reset,
  }
})
