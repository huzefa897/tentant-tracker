import type { AuthUser } from '@/types/auth'
import { isValidIndianPhoneNumber } from '@/utils/authValidation'

// Temporary mock-session persistence. Firebase manages its own session later.
const AUTH_USER_KEY = 'rent-tracker-auth-user'
// Per-tab, so a refresh on /verify keeps the flow but a new tab starts at login.
const PENDING_PHONE_KEY = 'rent-tracker-pending-phone'

export function saveAuthUser(user: AuthUser) {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
}

export function getStoredAuthUser(): AuthUser | null {
  const stored = localStorage.getItem(AUTH_USER_KEY)

  if (!stored) return null

  try {
    return JSON.parse(stored) as AuthUser
  } catch {
    clearStoredAuthUser()
    return null
  }
}

export function clearStoredAuthUser() {
  localStorage.removeItem(AUTH_USER_KEY)
}

export function savePendingPhoneNumber(phoneNumber: string) {
  sessionStorage.setItem(PENDING_PHONE_KEY, phoneNumber)
}

export function getStoredPendingPhoneNumber(): string | null {
  const stored = sessionStorage.getItem(PENDING_PHONE_KEY)

  if (stored && isValidIndianPhoneNumber(stored)) return stored

  clearStoredPendingPhoneNumber()
  return null
}

export function clearStoredPendingPhoneNumber() {
  sessionStorage.removeItem(PENDING_PHONE_KEY)
}
