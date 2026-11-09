// Dev login: local development only, signs in as an existing person by email, with no Google or
// Firebase. It exists only in `npm run dev` and only when VITE_DEV_LOGIN_EMAIL is set; the backend
// accepts it only with DJANGO_ENV=dev. See docs/auth-and-access.md ("Dev login").
//
// Every function starts with `if (!import.meta.env.DEV)`: a production build replaces it with
// `if (true)`, so the minifier drops the rest and none of this ships (checked by
// scripts/check-no-dev-login.sh in CI).

import { AuthError } from '@/services/authErrors'
import type { AuthUser } from '@/types/auth'

type Listener = (user: AuthUser | null) => void
const listeners = new Set<Listener>()

// "dev-login-only" is the marker scripts/check-no-dev-login.sh looks for in a production build:
// keep it in this key (and on DevSignInButton) so the check stays tied to the code, not to copy.
function storageKey() {
  return 'rent-tracker.dev-login-only.email'
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const DEV_USER_PREFIX = 'dev:'

function toUser(email: string): AuthUser {
  return { id: `${DEV_USER_PREFIX}${email}`, email }
}

// Whether this user signed in through dev login (their id is never a Firebase UID).
export function isDevUser(user: AuthUser | null): boolean {
  if (!import.meta.env.DEV) return false
  return user?.id.startsWith(DEV_USER_PREFIX) ?? false
}

// The email the login page offers to sign in as, or null when dev login is off.
export function devLoginEmail(): string | null {
  if (!import.meta.env.DEV) return null
  return import.meta.env.VITE_DEV_LOGIN_EMAIL?.trim().toLowerCase() || null
}

// The saved dev session, if dev login is on and the saved email is still the configured one.
export function readDevSession(): AuthUser | null {
  if (!import.meta.env.DEV) return null
  const configured = devLoginEmail()
  if (!configured) return null
  return storage()?.getItem(storageKey()) === configured ? toUser(configured) : null
}

export function startDevSession(): AuthUser {
  if (!import.meta.env.DEV) throw new AuthError('not-configured', 'Dev login is off.')
  const email = devLoginEmail()
  if (!email) throw new AuthError('not-configured', 'Dev login is off.')
  storage()?.setItem(storageKey(), email)
  const user = toUser(email)
  listeners.forEach((listener) => listener(user))
  return user
}

export function endDevSession(): void {
  if (!import.meta.env.DEV) return
  storage()?.removeItem(storageKey())
  listeners.forEach((listener) => listener(null))
}

// Told when a dev session starts or ends, in this tab or another one (not with the current state:
// read it with readDevSession).
export function subscribeToDevSession(listener: Listener): () => void {
  if (!import.meta.env.DEV) return () => {}
  listeners.add(listener)
  // Another tab signing in or out changes localStorage, which fires `storage` here.
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey() || event.key === null) listener(readDevSession())
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
