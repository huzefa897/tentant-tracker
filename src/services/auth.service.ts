import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'

import { AuthError, type AuthErrorCode } from '@/services/authErrors'
import {
  devLoginEmail,
  endDevSession,
  readDevSession,
  startDevSession,
  subscribeToDevSession,
} from '@/services/devLogin'
import { getFirebaseAuth } from '@/services/firebase'
import type { AuthUser } from '@/types/auth'

// Firebase Google sign-in. Firebase keeps the session itself (IndexedDB) and restores it
// asynchronously on load; listen with onAuthStateChanged rather than reading it synchronously.

const FIREBASE_ERROR_CODES: Record<string, AuthErrorCode> = {
  'auth/popup-closed-by-user': 'cancelled',
  'auth/cancelled-popup-request': 'cancelled',
  'auth/user-cancelled': 'cancelled',
  'auth/popup-blocked': 'popup-blocked',
  'auth/account-exists-with-different-credential': 'account-exists',
  'auth/too-many-requests': 'too-many-requests',
  'auth/network-request-failed': 'network',
  'auth/user-disabled': 'user-disabled',
  // Google sign-in disabled, bad API key, unlisted domain or a browser that can't do popups.
  'auth/operation-not-allowed': 'not-configured',
  'auth/operation-not-supported-in-this-environment': 'not-configured',
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
  return { id: user.uid, email: user.email ?? '' }
}

export const authService = {
  // Called once with the restored session (or null), then on every sign-in/out.
  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void {
    if (!devLoginEmail()) {
      return onAuthStateChanged(getFirebaseAuth(), (user) =>
        listener(user ? toAuthUser(user) : null),
      )
    }

    // Dev login (local development only). Firebase is still followed, so a Google sign-in after a
    // dev logout is tracked as usual, but it's optional (a machine with no config can still reach
    // the login page) and ignored while a dev session is active.
    const stopDev = subscribeToDevSession(listener)
    const session = readDevSession()
    if (session) listener(session)

    let stopFirebase = () => {}
    try {
      stopFirebase = onAuthStateChanged(getFirebaseAuth(), (user) => {
        if (!readDevSession()) listener(user ? toAuthUser(user) : null)
      })
    } catch {
      // No Firebase config: only dev login can sign in.
      if (!session) listener(null)
    }
    return () => {
      stopDev()
      stopFirebase()
    }
  },

  // The email dev login signs in as, or null when it's off (always in production builds).
  devLoginEmail,

  // Local development only: signs in as devLoginEmail() without Google.
  signInAsDev(): AuthUser {
    return startDevSession()
  },

  // Opens Google's account chooser in a popup; call it straight from a click, or the browser
  // may block it. Whether this account may use the app is the backend's call (/me).
  async signInWithGoogle(): Promise<AuthUser> {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })

    try {
      const credential = await signInWithPopup(getFirebaseAuth(), provider)
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

  // The Authorization header for the API: a dev session's email, else the Firebase ID token.
  async getAuthorization(): Promise<string | null> {
    const dev = readDevSession()
    if (dev) return `Dev ${dev.email}`
    const token = await this.getIdToken()
    return token ? `Bearer ${token}` : null
  },

  async logout(): Promise<void> {
    if (readDevSession()) {
      endDevSession()
      return
    }
    await signOut(getFirebaseAuth())
  },
}
