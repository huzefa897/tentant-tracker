import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/services/auth.service', () => ({
  authService: {
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
    logout: vi.fn(),
  },
}))

const phoneNumber = '+918341413827'
const user = { id: 'mock-user-1', phoneNumber }

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.mocked(authService.sendOtp).mockReset().mockResolvedValue()
  vi.mocked(authService.verifyOtp).mockReset().mockResolvedValue(user)
  vi.mocked(authService.logout).mockReset().mockResolvedValue()
  setActivePinia(createPinia())
})

describe('initial state', () => {
  it('starts signed out with no pending number', () => {
    const store = useAuthStore()

    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(store.pendingPhoneNumber).toBeNull()
  })

  it('restores the session and pending number from storage', () => {
    localStorage.setItem('rent-tracker-auth-user', JSON.stringify(user))
    sessionStorage.setItem('rent-tracker-pending-phone', phoneNumber)

    const store = useAuthStore()

    expect(store.user).toEqual(user)
    expect(store.isAuthenticated).toBe(true)
    expect(store.pendingPhoneNumber).toBe(phoneNumber)
  })
})

describe('sendOtp', () => {
  it('stores the pending number on success', async () => {
    const store = useAuthStore()

    await store.sendOtp(phoneNumber)

    expect(authService.sendOtp).toHaveBeenCalledWith({ phoneNumber })
    expect(store.pendingPhoneNumber).toBe(phoneNumber)
    expect(sessionStorage.getItem('rent-tracker-pending-phone')).toBe(phoneNumber)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('sets loading while the request is in flight', async () => {
    const store = useAuthStore()

    const pending = store.sendOtp(phoneNumber)
    expect(store.loading).toBe(true)
    await pending

    expect(store.loading).toBe(false)
  })

  it('sets an error and rethrows on failure', async () => {
    vi.mocked(authService.sendOtp).mockRejectedValue(new Error('boom'))
    const store = useAuthStore()

    await expect(store.sendOtp(phoneNumber)).rejects.toThrow('boom')

    expect(store.error).toBe('Unable to send verification code. Please try again.')
    expect(store.pendingPhoneNumber).toBeNull()
    expect(store.loading).toBe(false)
  })
})

describe('verifyOtp', () => {
  it('throws when there is no pending number', async () => {
    const store = useAuthStore()

    await expect(store.verifyOtp('924636')).rejects.toThrow('Phone number missing')
    expect(authService.verifyOtp).not.toHaveBeenCalled()
  })

  it('signs in, persists the session and clears the pending number', async () => {
    const store = useAuthStore()
    await store.sendOtp(phoneNumber)

    await store.verifyOtp('924636')

    expect(authService.verifyOtp).toHaveBeenCalledWith({ phoneNumber, code: '924636' })
    expect(store.user).toEqual(user)
    expect(store.isAuthenticated).toBe(true)
    expect(JSON.parse(localStorage.getItem('rent-tracker-auth-user')!)).toEqual(user)
    expect(store.pendingPhoneNumber).toBeNull()
    expect(sessionStorage.getItem('rent-tracker-pending-phone')).toBeNull()
  })

  it('keeps the pending number and sets an error on a wrong code', async () => {
    vi.mocked(authService.verifyOtp).mockRejectedValue(new Error('Invalid verification code'))
    const store = useAuthStore()
    await store.sendOtp(phoneNumber)

    await expect(store.verifyOtp('111111')).rejects.toThrow()

    expect(store.error).toBe('Invalid verification code. Please try again.')
    expect(store.isAuthenticated).toBe(false)
    expect(store.pendingPhoneNumber).toBe(phoneNumber)
  })
})

describe('resetOtpFlow and clearError', () => {
  it('resetOtpFlow clears the pending number and error', async () => {
    vi.mocked(authService.verifyOtp).mockRejectedValue(new Error('nope'))
    const store = useAuthStore()
    await store.sendOtp(phoneNumber)
    await store.verifyOtp('111111').catch(() => {})

    store.resetOtpFlow()

    expect(store.pendingPhoneNumber).toBeNull()
    expect(sessionStorage.getItem('rent-tracker-pending-phone')).toBeNull()
    expect(store.error).toBeNull()
  })

  it('clearError only clears the error', async () => {
    vi.mocked(authService.verifyOtp).mockRejectedValue(new Error('nope'))
    const store = useAuthStore()
    await store.sendOtp(phoneNumber)
    await store.verifyOtp('111111').catch(() => {})

    store.clearError()

    expect(store.error).toBeNull()
    expect(store.pendingPhoneNumber).toBe(phoneNumber)
  })
})

describe('logout', () => {
  it('clears the user, stored session and OTP flow', async () => {
    localStorage.setItem('rent-tracker-auth-user', JSON.stringify(user))
    const store = useAuthStore()

    await store.logout()

    expect(authService.logout).toHaveBeenCalled()
    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(localStorage.getItem('rent-tracker-auth-user')).toBeNull()
  })

  // Saved rent entries belong to the device for now, not the session.
  it('keeps saved rent entries', async () => {
    localStorage.setItem('rent-tracker-auth-user', JSON.stringify(user))
    localStorage.setItem('rent-tracker:rent-entries:v1', '{"version":1,"entries":[]}')
    const store = useAuthStore()

    await store.logout()

    expect(localStorage.getItem('rent-tracker:rent-entries:v1')).toBe('{"version":1,"entries":[]}')
  })
})
