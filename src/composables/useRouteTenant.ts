import { computed, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { isRetryableError } from '@/services/apiError'
import { rateLimitWaitMs } from '@/services/rateLimit'
import { tenantErrorMessage, useTenantStore } from '@/stores/tenant'

const RETRY_MS = 10_000

export type RouteTenantStatus = 'loading' | 'error' | 'missing' | 'ready'

// The tenant named in the URL, for pages that can be opened directly: loaded through the detail
// API unless already known, so it never depends on visiting the dashboard first. A failed load
// shows as 'error' (with retry), never as 'missing', so an outage doesn't read as "not found".
export function useRouteTenant(tenantId: MaybeRefOrGetter<string>) {
  const tenantStore = useTenantStore()
  const loadState = ref<'loading' | 'done' | 'error'>('loading')
  const error = ref<string | null>(null)

  // From the store, so it follows a reset (e.g. switching property) immediately.
  const tenant = computed(() => tenantStore.getTenant(toValue(tenantId)))

  const status = computed<RouteTenantStatus>(() => {
    if (tenant.value) return 'ready'
    if (loadState.value === 'error') return 'error'
    if (loadState.value === 'loading') return 'loading'
    return 'missing'
  })

  // Only the latest load (for the current id) may change state.
  let loadSeq = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const retryable = ref(true)

  function stopRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function runScheduledRetry() {
    retryTimer = null
    const wait = rateLimitWaitMs()
    if (wait > 0) {
      retryTimer = setTimeout(runScheduledRetry, wait)
      return
    }
    void load()
  }

  async function load() {
    stopRetry()
    const seq = ++loadSeq
    loadState.value = 'loading'
    error.value = null
    retryable.value = true

    try {
      await tenantStore.loadTenant(toValue(tenantId))
      if (seq === loadSeq) loadState.value = 'done'
    } catch (err) {
      if (seq !== loadSeq) return
      const canRetry = isRetryableError(err)
      error.value = tenantErrorMessage(err)
      loadState.value = 'error'
      retryable.value = canRetry
      if (canRetry) {
        retryTimer = setTimeout(runScheduledRetry, Math.max(RETRY_MS, rateLimitWaitMs()))
      }
    }
  }

  // The router reuses the page when only the id changes, so load again then. Synchronously, so
  // the new id never shows as 'missing' before its load starts.
  watch(() => toValue(tenantId), load, { immediate: true, flush: 'sync' })
  onUnmounted(() => {
    loadSeq++ // prevents any in-flight load from scheduling a retry after unmount
    stopRetry()
  })

  return {
    tenant,
    status,
    error: computed(() => error.value),
    retryable: computed(() => retryable.value),
    retry: load,
  }
}
