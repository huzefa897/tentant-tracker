import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { authService } from '@/services/auth.service'
import { AuthError, type AuthErrorCode } from '@/services/authErrors'
import type { AuthUser } from '@/types/auth'

const SEND_MESSAGES: Partial<Record<AuthErrorCode, string>> = {
  'invalid-phone-number': 'Enter a valid mobile number.',
  'too-many-requests': 'Too many attempts. Please wait a while and try again.',
  'captcha-failed': 'The security check failed. Refresh the page and try again.',
  network: 'No connection. Check your internet and try again.',
  'not-configured': "Phone sign-in isn't available right now. Contact the property owner.",
}

const VERIFY_MESSAGES: Partial<Record<AuthErrorCode, string>> = {
  'invalid-code': 'Invalid verification code. Please try again.',
  'code-expired': 'This code has expired. Request a new one.',
  'session-missing': 'Your sign-in expired. Request a new code.',
  'too-many-requests': 'Too many attempts. Please wait a while and try again.',
  'user-disabled': 'This account has been disabled. Contact the property owner.',
  network: 'No connection. Check your internet and try again.',
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
  const setupError = ref<string | null>(null)
  // In memory only, like Firebase's pending confirmation: a refresh on /verify starts over.
  const pendingPhoneNumber = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => user.value !== null)

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
        setupError.value = messageFor(err, SEND_MESSAGES, 'Sign-in is unavailable right now.')
        ready.value = true
        resolve()
      }
    })

    return readyPromise
  }

  async function sendOtp(phoneNumber: string, recaptchaHost: HTMLElement) {
    loading.value = true
    error.value = null

    try {
      await authService.sendOtp({ phoneNumber }, recaptchaHost)
      pendingPhoneNumber.value = phoneNumber
    } catch (err) {
      error.value = messageFor(
        err,
        SEND_MESSAGES,
        'Unable to send verification code. Please try again.',
      )
      throw err
    } finally {
      loading.value = false
    }
  }

  async function verifyOtp(code: string) {
    if (!pendingPhoneNumber.value) {
      throw new Error('Phone number missing')
    }

    loading.value = true
    error.value = null

    try {
      // onAuthStateChanged reports the same user; setting it here avoids waiting for that.
      user.value = await authService.verifyOtp({ code })
      pendingPhoneNumber.value = null
    } catch (err) {
      error.value = messageFor(err, VERIFY_MESSAGES, 'Unable to verify the code. Please try again.')
      throw err
    } finally {
      loading.value = false
    }
  }

  function resetOtpFlow() {
    pendingPhoneNumber.value = null
    error.value = null
  }

  function clearError() {
    error.value = null
  }

  async function logout() {
    await authService.logout()

    user.value = null
    resetOtpFlow()
  }

  return {
    user,
    ready,
    setupError,
    pendingPhoneNumber,
    loading,
    error,
    isAuthenticated,
    init,
    sendOtp,
    verifyOtp,
    resetOtpFlow,
    clearError,
    logout,
  }
})
