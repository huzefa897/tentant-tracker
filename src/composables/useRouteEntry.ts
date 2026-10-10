import { computed, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { entryLoadErrorMessage, useRentEntryStore } from '@/stores/rentEntry'

const RETRY_MS = 10_000

export type RouteEntryStatus = 'loading' | 'error' | 'missing' | 'ready'

// The bill named in the URL, for the details page: loaded from the backend unless already known,
// so a refresh or a shared link works. Matched on both ids, so a bill never shows under another
// tenant. A failed load is 'error' (with retry), never 'missing': an outage isn't "not found".
export function useRouteEntry(
  tenantId: MaybeRefOrGetter<string>,
  entryId: MaybeRefOrGetter<string>,
) {
  const rentEntryStore = useRentEntryStore()
  const loadState = ref<'loading' | 'done' | 'error'>('loading')
  const error = ref<string | null>(null)

  // From the store, so it follows a reset (e.g. switching property) immediately.
  const entry = computed(() => rentEntryStore.getEntry(toValue(tenantId), toValue(entryId)))

  const status = computed<RouteEntryStatus>(() => {
    if (entry.value) return 'ready'
    if (loadState.value === 'error') return 'error'
    if (loadState.value === 'loading') return 'loading'
    return 'missing'
  })

  // Only the latest load (for the current ids) may change state.
  let loadSeq = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  function stopRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  async function load() {
    stopRetry()
    const seq = ++loadSeq
    loadState.value = 'loading'
    error.value = null

    try {
      await rentEntryStore.loadEntry(toValue(tenantId), toValue(entryId))
      if (seq === loadSeq) loadState.value = 'done'
    } catch (err) {
      if (seq !== loadSeq) return
      error.value = entryLoadErrorMessage(err)
      loadState.value = 'error'
      retryTimer = setTimeout(load, RETRY_MS)
    }
  }

  // The router reuses the page when only the ids change, so load again then.
  watch(() => [toValue(tenantId), toValue(entryId)], load, { immediate: true, flush: 'sync' })
  onUnmounted(stopRetry)

  return { entry, status, error: computed(() => error.value), retry: load }
}
