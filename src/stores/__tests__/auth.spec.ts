import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authService } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'
import { useAuthStore } from '@/stores/auth'
import { resetAuthService, signInAs, testUser } from '@/test/mocks/authService'
import type { AuthUser } from '@/types/auth'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const phoneNumber = '+918341413827'
const host = () => document.createElement('div')

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
      expect(store.pendingPhoneNumber).toBeNull()
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
        "Phone sign-in isn't available right now. Contact the property owner.",
      )
    })
  })

  describe('sendOtp', () => {
    it('passes the reCAPTCHA host and keeps the pending number on success', async () => {
      const store = useAuthStore()
      const element = host()

      await store.sendOtp(phoneNumber, element)

      expect(authService.sendOtp).toHaveBeenCalledWith({ phoneNumber }, element)
      expect(store.pendingPhoneNumber).toBe(phoneNumber)
    })

    it('sets loading while the request is in flight', async () => {
      const store = useAuthStore()

      const request = store.sendOtp(phoneNumber, host())
      expect(store.loading).toBe(true)

      await request
      expect(store.loading).toBe(false)
    })

    it('sets an error and rethrows on failure', async () => {
      vi.mocked(authService.sendOtp).mockRejectedValue(new Error('down'))
      const store = useAuthStore()

      await expect(store.sendOtp(phoneNumber, host())).rejects.toThrow('down')

      expect(store.error).toBe('Unable to send verification code. Please try again.')
      expect(store.pendingPhoneNumber).toBeNull()
      expect(store.loading).toBe(false)
    })

    it('explains known failures', async () => {
      vi.mocked(authService.sendOtp).mockRejectedValue(new AuthError('invalid-phone-number'))
      const store = useAuthStore()

      await store.sendOtp(phoneNumber, host()).catch(() => {})

      expect(store.error).toBe('Enter a valid mobile number.')
    })
  })

  describe('verifyOtp', () => {
    it('throws when there is no pending number', async () => {
      const store = useAuthStore()

      await expect(store.verifyOtp('924636')).rejects.toThrow('Phone number missing')
      expect(authService.verifyOtp).not.toHaveBeenCalled()
    })

    it('signs in and clears the pending number', async () => {
      const store = useAuthStore()
      await store.sendOtp(phoneNumber, host())

      await store.verifyOtp('924636')

      expect(authService.verifyOtp).toHaveBeenCalledWith({ code: '924636' })
      expect(store.user).toEqual(testUser)
      expect(store.pendingPhoneNumber).toBeNull()
    })

    it.each([
      ['invalid-code', 'Invalid verification code. Please try again.'],
      ['code-expired', 'This code has expired. Request a new one.'],
      ['session-missing', 'Your sign-in expired. Request a new code.'],
      ['user-disabled', 'This account has been disabled. Contact the property owner.'],
    ] as const)('keeps the pending number and explains %s', async (code, message) => {
      vi.mocked(authService.verifyOtp).mockRejectedValue(new AuthError(code))
      const store = useAuthStore()
      await store.sendOtp(phoneNumber, host())

      await expect(store.verifyOtp('111111')).rejects.toThrow(AuthError)

      expect(store.error).toBe(message)
      expect(store.pendingPhoneNumber).toBe(phoneNumber)
      expect(store.isAuthenticated).toBe(false)
    })

    it('falls back to a general message for unexpected failures', async () => {
      vi.mocked(authService.verifyOtp).mockRejectedValue(new Error('boom'))
      const store = useAuthStore()
      await store.sendOtp(phoneNumber, host())

      await store.verifyOtp('111111').catch(() => {})

      expect(store.error).toBe('Unable to verify the code. Please try again.')
    })
  })

  it('resetOtpFlow clears the pending number and error', async () => {
    vi.mocked(authService.sendOtp).mockRejectedValueOnce(new Error('down'))
    const store = useAuthStore()
    await store.sendOtp(phoneNumber, host()).catch(() => {})
    await store.sendOtp(phoneNumber, host())

    store.resetOtpFlow()

    expect(store.pendingPhoneNumber).toBeNull()
    expect(store.error).toBeNull()
  })

  it('clearError only clears the error', async () => {
    const store = useAuthStore()
    await store.sendOtp(phoneNumber, host())
    vi.mocked(authService.sendOtp).mockRejectedValueOnce(new Error('down'))
    await store.sendOtp(phoneNumber, host()).catch(() => {})

    store.clearError()

    expect(store.error).toBeNull()
    expect(store.pendingPhoneNumber).toBe(phoneNumber)
  })

  describe('logout', () => {
    it('signs out of Firebase and clears the user and OTP flow', async () => {
      signInAs()
      const store = useAuthStore()
      await store.init()

      await store.logout()

      expect(authService.logout).toHaveBeenCalled()
      expect(store.user).toBeNull()
      expect(store.pendingPhoneNumber).toBeNull()
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

    it('sending a new code clears the notice', async () => {
      const store = useAuthStore()
      await store.endSession('Not registered.')

      await store.sendOtp(phoneNumber, host())

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
