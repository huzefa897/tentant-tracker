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
  let deadlineAt = 0

  function signOut() {
    timerId = null
    deadlineAt = 0
    authStore.loginNotice = 'You were signed out after 15 minutes of inactivity.'
    void logout()
  }

  function schedule() {
    if (timerId !== null) clearTimeout(timerId)
    deadlineAt = Date.now() + INACTIVITY_MS
    timerId = setTimeout(signOut, INACTIVITY_MS)
  }

  function onActivity() {
    const now = Date.now()
    if (now - lastResetAt < THROTTLE_MS) return
    lastResetAt = now
    // Browsers can suspend timers while the device sleeps. If the deadline has
    // already passed when JS resumes, sign out immediately instead of granting
    // another full 15 minutes.
    if (deadlineAt > 0 && now >= deadlineAt) {
      signOut()
      return
    }
    schedule()
  }

  function onResumeCheck() {
    if (deadlineAt > 0 && Date.now() >= deadlineAt) signOut()
  }

  function onVisibilityResume() {
    if (document.visibilityState === 'visible') onResumeCheck()
  }

  function start() {
    lastResetAt = 0
    deadlineAt = 0
    schedule()
    for (const event of EVENTS) {
      window.addEventListener(event, onActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibilityResume)
    window.addEventListener('focus', onResumeCheck)
  }

  function stop() {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
    deadlineAt = 0
    for (const event of EVENTS) {
      window.removeEventListener(event, onActivity)
    }
    document.removeEventListener('visibilitychange', onVisibilityResume)
    window.removeEventListener('focus', onResumeCheck)
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
