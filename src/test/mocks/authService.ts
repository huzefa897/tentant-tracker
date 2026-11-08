import { vi } from 'vitest'

import type { AuthUser } from '@/types/auth'

// A fake authService for view, store and router tests. Use it with
//   vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
// and call resetAuthService() in beforeEach. Nothing here touches Firebase.

export const testUser: AuthUser = { id: 'firebase-uid-1', email: 'owner@example.com' }

let restoredUser: AuthUser | null = null

// The session Firebase "restores" when the auth store initialises.
export function signInAs(user: AuthUser | null = testUser) {
  restoredUser = user
}

export const authService = {
  onAuthStateChanged: vi.fn(),
  signInWithGoogle: vi.fn(),
  getIdToken: vi.fn(),
  getAuthorization: vi.fn(),
  devLoginEmail: vi.fn(),
  signInAsDev: vi.fn(),
  logout: vi.fn(),
}

export function resetAuthService() {
  restoredUser = null
  authService.onAuthStateChanged.mockReset().mockImplementation((listener) => {
    listener(restoredUser)
    return () => {}
  })
  authService.signInWithGoogle.mockReset().mockResolvedValue(testUser)
  authService.getIdToken.mockReset().mockResolvedValue('test-id-token')
  authService.getAuthorization.mockReset().mockResolvedValue('Bearer test-id-token')
  authService.devLoginEmail.mockReset().mockReturnValue(null)
  authService.signInAsDev.mockReset().mockReturnValue(testUser)
  authService.logout.mockReset().mockResolvedValue(undefined)
}

resetAuthService()
