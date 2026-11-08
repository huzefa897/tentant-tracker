import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authService } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'
import { useAuthStore } from '@/stores/auth'
import { resetAuthService, signInAs, testUser } from '@/test/mocks/authService'
import type { AuthUser } from '@/types/auth'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

beforeEach(() => {
  resetAuthService()
  setActivePinia(createPinia())
})

describe('auth store', () => {
  describe('init', () => {
    it('starts signed out and not ready', () => {
      const store = useAuthStore()

      expect(store.ready).toBe(false)
      expect(store.isAuthenticated).toBe(false)
    })

    it('becomes ready with the session Firebase restored', async () => {
      signInAs()
      const store = useAuthStore()

      await store.init()

      expect(store.ready).toBe(true)
      expect(store.user).toEqual(testUser)
    })

    it('becomes ready signed out when there is no session', async () => {
      const store = useAuthStore()

      await store.init()

      expect(store.ready).toBe(true)
      expect(store.isAuthenticated).toBe(false)
    })

    it('subscribes once however often it is called', async () => {
      const store = useAuthStore()

      await Promise.all([store.init(), store.init()])
      await store.init()

      expect(authService.onAuthStateChanged).toHaveBeenCalledTimes(1)
    })

    it('follows later sign-ins and sign-outs', async () => {
      let notify: (user: AuthUser | null) => void = () => {}
      vi.mocked(authService.onAuthStateChanged).mockImplementation((listener) => {
        notify = listener
        listener(testUser)
        return () => {}
      })
      const store = useAuthStore()
      await store.init()

      notify(null)

      expect(store.isAuthenticated).toBe(false)
    })

    it('becomes ready signed out with a setup error when Firebase cannot start', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(authService.onAuthStateChanged).mockImplementation(() => {
        throw new AuthError('not-configured')
      })
      const store = useAuthStore()

      await store.init()

      expect(store.ready).toBe(true)
      expect(store.isAuthenticated).toBe(false)
      expect(store.loginNotice).toBe(
        "Google sign-in isn't available right now. Contact the property owner.",
      )
    })
  })

  describe('signInAsDev', () => {
    it('signs in through the auth service and clears old messages', () => {
      const store = useAuthStore()
      store.loginNotice = 'old notice'

      store.signInAsDev()

      expect(authService.signInAsDev).toHaveBeenCalled()
      expect(store.user).toEqual(testUser)
      expect(store.loginNotice).toBeNull()
    })
  })

  describe('signInWithGoogle', () => {
    it('signs in with the Google account', async () => {
      const store = useAuthStore()

      await store.signInWithGoogle()

      expect(authService.signInWithGoogle).toHaveBeenCalled()
      expect(store.user).toEqual(testUser)
      expect(store.error).toBeNull()
    })

    it('sets loading while Google is open', async () => {
      const store = useAuthStore()

      const request = store.signInWithGoogle()
      expect(store.loading).toBe(true)

      await request
      expect(store.loading).toBe(false)
    })

    it("closing Google's window is not an error", async () => {
      vi.mocked(authService.signInWithGoogle).mockRejectedValue(new AuthError('cancelled'))
      const store = useAuthStore()

      await expect(store.signInWithGoogle()).resolves.toBeUndefined()

      expect(store.isAuthenticated).toBe(false)
      expect(store.error).toBeNull()
      expect(store.loading).toBe(false)
    })

    it.each([
      [
        'popup-blocked',
        'Your browser blocked the Google sign-in window. Allow pop-ups and try again.',
      ],
      [
        'account-exists',
        'This email is set up to sign in another way. Contact the property owner.',
      ],
      ['user-disabled', 'This account has been disabled. Contact the property owner.'],
      ['network', 'No connection. Check your internet and try again.'],
    ] as const)('explains %s and rethrows', async (code, message) => {
      vi.mocked(authService.signInWithGoogle).mockRejectedValue(new AuthError(code))
      const store = useAuthStore()

      await expect(store.signInWithGoogle()).rejects.toThrow(AuthError)

      expect(store.error).toBe(message)
      expect(store.isAuthenticated).toBe(false)
      expect(store.loading).toBe(false)
    })

    it('falls back to a general message for unexpected failures', async () => {
      vi.mocked(authService.signInWithGoogle).mockRejectedValue(new Error('boom'))
      const store = useAuthStore()

      await store.signInWithGoogle().catch(() => {})

      expect(store.error).toBe('Unable to sign in. Please try again.')
    })
  })

  it('clearError clears the error', async () => {
    vi.mocked(authService.signInWithGoogle).mockRejectedValueOnce(new Error('down'))
    const store = useAuthStore()
    await store.signInWithGoogle().catch(() => {})

    store.clearError()

    expect(store.error).toBeNull()
  })

  describe('logout', () => {
    it('signs out of Firebase and clears the user', async () => {
      signInAs()
      const store = useAuthStore()
      await store.init()

      await store.logout()

      expect(authService.logout).toHaveBeenCalled()
      expect(store.user).toBeNull()
    })

    it('endSession signs out and leaves a notice for the login page', async () => {
      signInAs()
      const store = useAuthStore()
      await store.init()

      await store.endSession('Not registered.')

      expect(authService.logout).toHaveBeenCalled()
      expect(store.isAuthenticated).toBe(false)
      expect(store.loginNotice).toBe('Not registered.')
    })

    it('signing in again clears the notice', async () => {
      const store = useAuthStore()
      await store.endSession('Not registered.')

      await store.signInWithGoogle()

      expect(store.loginNotice).toBeNull()
    })

    it('keeps saved rent entries', async () => {
      localStorage.setItem('rent-tracker:rent-entries:v1', 'kept')
      const store = useAuthStore()

      await store.logout()

      expect(localStorage.getItem('rent-tracker:rent-entries:v1')).toBe('kept')
      localStorage.clear()
    })
  })
})
