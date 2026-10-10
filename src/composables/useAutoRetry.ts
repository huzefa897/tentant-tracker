import { onUnmounted, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

const INITIAL_MS = 5_000
const MAX_MS = 30_000

// When status is 'error', schedules a retry using exponential backoff:
// 5 s → 10 s → 20 s → 30 s (capped). The attempt counter resets when status
// leaves 'error' for anything other than 'loading' (i.e. on success or idle).
export function useAutoRetry(status: MaybeRefOrGetter<string>, retry: () => void) {
  let timerId: ReturnType<typeof setTimeout> | null = null
  let attempt = 0

  function stop() {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  function scheduleRetry() {
    const delay = Math.min(INITIAL_MS * 2 ** attempt, MAX_MS)
    attempt++
    timerId = setTimeout(retry, delay)
  }

  watch(
    () => toValue(status),
    (s) => {
      stop()
      if (s === 'error') {
        scheduleRetry()
      } else if (s !== 'loading') {
        attempt = 0
      }
    },
    { immediate: true },
  )

  onUnmounted(stop)
}
