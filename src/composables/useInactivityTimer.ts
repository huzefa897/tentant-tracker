import { onUnmounted, watch } from 'vue'

import { useLogout } from '@/composables/useLogout'
import { useAuthStore } from '@/stores/auth'

const INACTIVITY_MS = 15 * 60 * 1000
const THROTTLE_MS = 1_000
const EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'pointerdown'] as const

export function useInactivityTimer() {
  const authStore = useAuthStore()
  const logout = useLogout()

  let timerId: ReturnType<typeof setTimeout> | null = null
  let lastResetAt = 0

  function schedule() {
    if (timerId !== null) clearTimeout(timerId)
    timerId = setTimeout(() => {
      timerId = null
      authStore.loginNotice = 'You were signed out after 15 minutes of inactivity.'
      void logout()
    }, INACTIVITY_MS)
  }

  function onActivity() {
    const now = Date.now()
    if (now - lastResetAt < THROTTLE_MS) return
    lastResetAt = now
    schedule()
  }

  function start() {
    lastResetAt = 0
    schedule()
    for (const event of EVENTS) {
      window.addEventListener(event, onActivity, { passive: true })
    }
  }

  function stop() {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
    for (const event of EVENTS) {
      window.removeEventListener(event, onActivity)
    }
  }

  watch(
    () => authStore.isAuthenticated,
    (isAuth) => {
      if (isAuth) start()
      else stop()
    },
    { immediate: true },
  )

  onUnmounted(stop)
}
