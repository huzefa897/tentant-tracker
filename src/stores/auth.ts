import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { authService } from '@/services/auth.service'
import { AuthError, type AuthErrorCode } from '@/services/authErrors'
import type { AuthUser } from '@/types/auth'

const SIGN_IN_MESSAGES: Partial<Record<AuthErrorCode, string>> = {
  'popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups and try again.',
  'account-exists': 'This email is set up to sign in another way. Contact the property owner.',
  'too-many-requests': 'Too many attempts. Please wait a while and try again.',
  'user-disabled': 'This account has been disabled. Contact the property owner.',
  network: 'No connection. Check your internet and try again.',
  'not-configured': "Google sign-in isn't available right now. Contact the property owner.",
}

function messageFor(
  error: unknown,
  messages: Partial<Record<AuthErrorCode, string>>,
  fallback: string,
) {
  return (error instanceof AuthError && messages[error.code]) || fallback
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  // False until Firebase has restored (or ruled out) a saved session. Guards wait for it.
  const ready = ref(false)
  // Shown on the login page: sign-in couldn't start, or the backend refused this account.
  const loginNotice = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)
  // Signed in through dev login (local development only), not Google.
  const isDevSession = computed(() => authService.isDevUser(user.value))

  let readyPromise: Promise<void> | null = null

  // Idempotent. Subscribes for the app's lifetime and resolves on the first auth state.
  function init(): Promise<void> {
    readyPromise ??= new Promise<void>((resolve) => {
      try {
        authService.onAuthStateChanged((authUser) => {
          user.value = authUser
          ready.value = true
          resolve()
        })
      } catch (err) {
        // e.g. missing Firebase config: treat as signed out and say so on the login page.
        console.error(err)
        loginNotice.value = messageFor(err, SIGN_IN_MESSAGES, 'Sign-in is unavailable right now.')
        ready.value = true
        resolve()
      }
    })

    return readyPromise
  }

  // Resolves once signed in; closing Google's window resolves too, with nobody signed in and no
  // error, since that's the person's choice.
  async function signInWithGoogle() {
    loading.value = true
    error.value = null
    loginNotice.value = null

    try {
      // onAuthStateChanged reports the same user; setting it here avoids waiting for that.
      user.value = await authService.signInWithGoogle()
    } catch (err) {
      if (err instanceof AuthError && err.code === 'cancelled') return
      error.value = messageFor(err, SIGN_IN_MESSAGES, 'Unable to sign in. Please try again.')
      throw err
    } finally {
      loading.value = false
    }
  }

  // Local development only (dev login, no Google); the backend must run with DJANGO_ENV=dev.
  function signInAsDev() {
    error.value = null
    loginNotice.value = null
    user.value = authService.signInAsDev()
  }

  function clearError() {
    error.value = null
  }

  async function logout() {
    await authService.logout()

    user.value = null
    error.value = null
  }

  // Signs out of Firebase and explains why on the login page, e.g. an account nobody added.
  async function endSession(notice: string) {
    await logout()
    loginNotice.value = notice
  }

  return {
    user,
    ready,
    loginNotice,
    loading,
    error,
    isAuthenticated,
    isDevSession,
    init,
    signInWithGoogle,
    signInAsDev,
    devLoginEmail: authService.devLoginEmail,
    clearError,
    logout,
    endSession,
  }
})
