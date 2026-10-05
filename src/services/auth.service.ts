import {
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  type User,
} from 'firebase/auth'

import { AuthError, type AuthErrorCode } from '@/services/authErrors'
import { getFirebaseAuth } from '@/services/firebase'
import type { AuthUser, SendOtpRequest, VerifyOtpRequest } from '@/types/auth'
import { isValidOtpCode, isValidPhoneNumber } from '@/utils/authValidation'

// Firebase phone auth. Firebase keeps the session itself (IndexedDB) and restores it
// asynchronously on load; listen with onAuthStateChanged rather than reading it synchronously.

// Lives in memory only: a refresh on /verify can't resume, so the user requests a new code.
let confirmation: ConfirmationResult | null = null

const FIREBASE_ERROR_CODES: Record<string, AuthErrorCode> = {
  'auth/invalid-phone-number': 'invalid-phone-number',
  'auth/missing-phone-number': 'invalid-phone-number',
  'auth/invalid-verification-code': 'invalid-code',
  'auth/missing-verification-code': 'invalid-code',
  'auth/code-expired': 'code-expired',
  'auth/too-many-requests': 'too-many-requests',
  'auth/quota-exceeded': 'too-many-requests',
  'auth/captcha-check-failed': 'captcha-failed',
  'auth/invalid-app-credential': 'captcha-failed',
  'auth/missing-app-credential': 'captcha-failed',
  'auth/network-request-failed': 'network',
  'auth/user-disabled': 'user-disabled',
  // Phone sign-in disabled, SMS region not allowed, billing, bad API key or unlisted domain.
  'auth/operation-not-allowed': 'not-configured',
  'auth/billing-not-enabled': 'not-configured',
  'auth/invalid-api-key': 'not-configured',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'not-configured',
  'auth/configuration-not-found': 'not-configured',
  'auth/unauthorized-domain': 'not-configured',
  'auth/app-not-authorized': 'not-configured',
}

export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error

  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  const message = error instanceof Error ? error.message : String(error)

  const authError = new AuthError(FIREBASE_ERROR_CODES[code] ?? 'unknown', message)

  // Users see a general message for these; the Firebase code says what to fix.
  if (authError.code === 'not-configured' || authError.code === 'unknown') {
    console.error(`Firebase sign-in failed (${code || 'no code'}): ${message}`)
  }

  return authError
}

function toAuthUser(user: User): AuthUser {
  return { id: user.uid, phoneNumber: user.phoneNumber ?? '' }
}

export const authService = {
  // Called once with the restored session (or null), then on every sign-in/out.
  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(getFirebaseAuth(), (user) => listener(user ? toAuthUser(user) : null))
  },

  // recaptchaHost: an element in the calling page for Firebase's invisible reCAPTCHA. A fresh
  // container is used per attempt and removed after, so retries never hit "already rendered".
  async sendOtp(payload: SendOtpRequest, recaptchaHost: HTMLElement): Promise<void> {
    if (!isValidPhoneNumber(payload.phoneNumber)) {
      throw new AuthError('invalid-phone-number')
    }

    const auth = getFirebaseAuth()
    const container = document.createElement('div')
    recaptchaHost.append(container)
    const verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' })

    try {
      confirmation = await signInWithPhoneNumber(auth, payload.phoneNumber, verifier)
    } catch (error) {
      throw toAuthError(error)
    } finally {
      verifier.clear()
      container.remove()
    }
  },

  async verifyOtp(payload: VerifyOtpRequest): Promise<AuthUser> {
    if (!isValidOtpCode(payload.code)) {
      throw new AuthError('invalid-code')
    }

    if (!confirmation) {
      throw new AuthError('session-missing')
    }

    try {
      const credential = await confirmation.confirm(payload.code)
      confirmation = null
      return toAuthUser(credential.user)
    } catch (error) {
      throw toAuthError(error)
    }
  },

  // A current ID token for the API, or null when signed out. Firebase caches it and refreshes
  // it shortly before it expires; never store it ourselves or force a refresh per request.
  async getIdToken(): Promise<string | null> {
    const auth = getFirebaseAuth()
    await auth.authStateReady()
    return auth.currentUser ? auth.currentUser.getIdToken() : null
  },

  async logout(): Promise<void> {
    confirmation = null
    await signOut(getFirebaseAuth())
  },
}
