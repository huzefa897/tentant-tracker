import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, RATE_LIMITED_MESSAGE } from '@/services/apiError'
import { dashboardService } from '@/services/dashboard.service'
import { useAccessStore } from '@/stores/access'
import type {
  DashboardSummary,
  PeriodFilters,
  PreparationFilter,
  RentalPeriodPage,
  TimingFilter,
} from '@/types/dashboard'

export type DashboardLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export const DASHBOARD_LOAD_ERROR_MESSAGE = 'Unable to load rent due. Please try again.'

export function dashboardErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'

  switch (kind) {
    case 'network':
      return "Couldn't reach the server. Check your connection and try again."
    case 'unavailable':
      return 'Rent due is unavailable right now. Please try again shortly.'
    case 'unauthorized':
      return "Your sign-in couldn't be verified. Log out and sign in again."
    case 'rate-limited':
      return RATE_LIMITED_MESSAGE
    default:
      return DASHBOARD_LOAD_ERROR_MESSAGE
  }
}

export const NOT_OWED_ERROR_MESSAGE = "Couldn't mark the month as not owed. Please try again."

function notOwedErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return NOT_OWED_ERROR_MESSAGE
  if (error.code === 'period_has_bill') return 'This month has a bill. Void the bill first.'
  if (error.code === 'not_owed_conflict')
    return 'This month was already marked not owed, with another reason.'
  switch (error.kind) {
    case 'forbidden':
      return "Only the property's owners can mark a month not owed."
    case 'invalid-request':
      return error.fieldErrors.reason ?? NOT_OWED_ERROR_MESSAGE
    case 'not-found':
      return "This month couldn't be found. Refresh and try again."
    case 'network':
    case 'unavailable':
    case 'unauthorized':
    case 'rate-limited':
      return dashboardErrorMessage(error)
    default:
      return NOT_OWED_ERROR_MESSAGE
  }
}

// The selected property's dashboard: its summary and one page of the months still owed (for
// the chosen filters). A refresh loads both together and replaces them only when both arrive,
// so the screen never mixes two moments; a failed refresh keeps what was shown, with when it
// was loaded. Nothing here is ever a zero or an empty list standing in for a failed load.
export const useDashboardStore = defineStore('dashboard', () => {
  const accessStore = useAccessStore()

  const summary = ref<DashboardSummary | null>(null)
  const periods = ref<RentalPeriodPage | null>(null)

  // The whole dashboard: 'loading' and 'error' only until it has loaded once.
  const status = ref<DashboardLoadStatus>('idle')
  const error = ref<string | null>(null)
  // A refresh of a dashboard already shown, and why the last one failed (its figures stay).
  const refreshing = ref(false)
  const refreshError = ref<string | null>(null)
  // When everything shown was loaded (Date.now()), for "Updated 30 seconds ago".
  const loadedAt = ref<number | null>(null)

  // The list's filters and page, reloaded on their own: the summary never changes with them.
  const filters = ref<PeriodFilters>({ timing: 'due', preparation: 'all', month: null })
  const page = ref(1)
  const periodsStatus = ref<DashboardLoadStatus>('idle')
  const periodsError = ref<string | null>(null)

  // Marking a month not owed: the period being saved, and why the last attempt failed.
  const markingId = ref<string | null>(null)
  const markError = ref<string | null>(null)

  const loaded = computed(() => loadedAt.value !== null)

  // Each request gets a number per part; only the newest may change state. reset() bumps them
  // all, discarding responses for the old property.
  let refreshSeq = 0
  let periodsSeq = 0
  let inFlight: Promise<void> | null = null

  // Both parts, together. While one is running, another call waits for it rather than sending
  // the requests again. Also the first load and Retry.
  function refresh(): Promise<void> {
    if (inFlight) return inFlight
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return Promise.resolve()

    const seq = ++refreshSeq
    const periodsAt = ++periodsSeq
    refreshing.value = true
    if (!loaded.value) {
      status.value = 'loading'
      error.value = null
    }

    const run = (async () => {
      try {
        const [nextSummary, nextPeriods] = await Promise.all([
          dashboardService.getSummary(propertyId),
          dashboardService.getRentalPeriods(propertyId, { ...filters.value }, page.value),
        ])
        if (seq !== refreshSeq) return
        summary.value = nextSummary
        // A filter or page changed while this ran: its own reload wins for the list.
        if (periodsAt === periodsSeq) {
          periods.value = nextPeriods
          periodsStatus.value = 'ready'
          periodsError.value = null
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

  async function loadPeriods() {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return

    const seq = ++periodsSeq
    periodsStatus.value = 'loading'
    periodsError.value = null
    try {
      const result = await dashboardService.getRentalPeriods(
        propertyId,
        { ...filters.value },
        page.value,
      )
      if (seq !== periodsSeq) return
      periods.value = result
      periodsStatus.value = 'ready'
    } catch (err) {
      if (seq !== periodsSeq) return
      periodsStatus.value = 'error'
      periodsError.value = dashboardErrorMessage(err)
    }
  }

  function setFilters(next: Partial<PeriodFilters>) {
    const merged = { ...filters.value, ...next }
    const current = filters.value
    if (
      merged.timing === current.timing &&
      merged.preparation === current.preparation &&
      merged.month === current.month
    )
      return
    filters.value = merged
    page.value = 1
    void loadPeriods()
  }

  function setTiming(timing: TimingFilter) {
    setFilters({ timing })
  }

  function setPreparation(preparation: PreparationFilter) {
    setFilters({ preparation })
  }

  function setMonth(month: string | null) {
    setFilters({ month })
  }

  function goToPage(next: number) {
    page.value = next
    void loadPeriods()
  }

  // Also the list's Retry.
  function retryPeriods() {
    void loadPeriods()
  }

  // Saved by the backend first; the dashboard then refreshes, so the month leaves the list and
  // the counts together. Resolves true once it's saved.
  async function markNotOwed(periodId: string, reason: string): Promise<boolean> {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId || markingId.value) return false

    markingId.value = periodId
    markError.value = null
    try {
      await dashboardService.markNotOwed(propertyId, periodId, reason)
    } catch (err) {
      markError.value = notOwedErrorMessage(err)
      return false
    } finally {
      markingId.value = null
    }
    await refresh()
    return true
  }

  function clearMarkError() {
    markError.value = null
  }

  function reset() {
    refreshSeq++
    periodsSeq++
    inFlight = null
    summary.value = null
    periods.value = null
    status.value = 'idle'
    error.value = null
    refreshing.value = false
    refreshError.value = null
    loadedAt.value = null
    filters.value = { timing: 'due', preparation: 'all', month: null }
    page.value = 1
    periodsStatus.value = 'idle'
    periodsError.value = null
    markingId.value = null
    markError.value = null
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
    periods,
    status,
    error,
    refreshing,
    refreshError,
    loadedAt,
    loaded,
    filters,
    page,
    periodsStatus,
    periodsError,
    markingId,
    markError,
    refresh,
    setFilters,
    setTiming,
    setPreparation,
    setMonth,
    goToPage,
    retryPeriods,
    markNotOwed,
    clearMarkError,
    reset,
  }
})
