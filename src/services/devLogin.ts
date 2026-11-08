// Dev login: local development only, signs in as an existing person by email, with no Google or
// Firebase. It exists only in `npm run dev` and only when VITE_DEV_LOGIN_EMAIL is set; the backend
// accepts it only with DJANGO_ENV=dev. See docs/auth-and-access.md ("Dev login").
//
// Every function starts with `if (!import.meta.env.DEV)`: a production build replaces it with
// `if (true)`, so the minifier drops the rest and none of this ships (checked by
// scripts/check-no-dev-login.sh in CI).

import type { AuthUser } from '@/types/auth'

type Listener = (user: AuthUser | null) => void
const listeners = new Set<Listener>()

function storageKey() {
  return 'rent-tracker.dev-login-email'
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function toUser(email: string): AuthUser {
  return { id: `dev:${email}`, email }
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
  if (!import.meta.env.DEV) throw new Error('Dev login is off.')
  const email = devLoginEmail()
  if (!email) throw new Error('Dev login is off.')
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

// Told when a dev session starts or ends (not with the current state: read it with readDevSession).
export function subscribeToDevSession(listener: Listener): () => void {
  if (!import.meta.env.DEV) return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}
