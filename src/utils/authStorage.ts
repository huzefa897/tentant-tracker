import type { AuthUser } from '@/types/auth'

// Temporary mock-session persistence. Firebase manages its own session later.
const AUTH_USER_KEY = 'rent-tracker-auth-user'

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
