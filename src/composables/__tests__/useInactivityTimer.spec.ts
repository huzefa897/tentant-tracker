import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInactivityTimer } from '@/composables/useInactivityTimer'
import { useAuthStore } from '@/stores/auth'
import { resetAuthService, signInAs } from '@/test/mocks/authService'

const mockLogout = vi.hoisted(() => vi.fn())
vi.mock('@/composables/useLogout', () => ({ useLogout: () => mockLogout }))
vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const INACTIVITY_MS = 15 * 60 * 1000

let wrapper: ReturnType<typeof mount> | null = null

function mountTimer() {
  wrapper = mount(
    defineComponent({
      setup() {
        useInactivityTimer()
        return () => null
      },
    }),
  )
}

async function signIn() {
  signInAs()
  await useAuthStore().init()
}

beforeEach(() => {
  vi.useFakeTimers()
  mockLogout.mockResolvedValue(undefined)
  resetAuthService()
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useInactivityTimer', () => {
  it('does not sign out when not authenticated', async () => {
    mountTimer()
    vi.advanceTimersByTime(INACTIVITY_MS)
    await flushPromises()
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('signs out after 15 minutes of inactivity', async () => {
    await signIn()
    mountTimer()
    vi.advanceTimersByTime(INACTIVITY_MS)
    await flushPromises()
    expect(mockLogout).toHaveBeenCalledOnce()
  })

  it('sets a loginNotice before signing out', async () => {
    await signIn()
    mountTimer()
    const authStore = useAuthStore()
    vi.advanceTimersByTime(INACTIVITY_MS)
    await flushPromises()
    expect(authStore.loginNotice).toBe('You were signed out after 15 minutes of inactivity.')
  })

  it('resets the timer on user activity and does not sign out until inactive again', async () => {
    await signIn()
    mountTimer()

    // Activity 14 minutes in resets the countdown
    vi.advanceTimersByTime(14 * 60 * 1000)
    window.dispatchEvent(new Event('click'))
    expect(mockLogout).not.toHaveBeenCalled()

    // Another 15 minutes pass → timed out from last activity
    vi.advanceTimersByTime(INACTIVITY_MS)
    await flushPromises()
    expect(mockLogout).toHaveBeenCalledOnce()
  })

  it('does not sign out before 15 minutes have passed since last activity', async () => {
    await signIn()
    mountTimer()

    vi.advanceTimersByTime(14 * 60 * 1000)
    window.dispatchEvent(new Event('keydown'))

    // 14 minutes after that click, still within the window
    vi.advanceTimersByTime(14 * 60 * 1000)
    await flushPromises()
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('throttles resets so rapid activity does not reset the timer more than once per second', async () => {
    await signIn()
    mountTimer()

    // Advance almost to the timeout, then click twice within 500 ms
    vi.advanceTimersByTime(INACTIVITY_MS - 2000)
    window.dispatchEvent(new Event('click')) // resets: fires in 15 min from now
    vi.advanceTimersByTime(500)
    window.dispatchEvent(new Event('click')) // throttled; no second reset

    // 1500 ms after first click: the timer from the first reset fires
    vi.advanceTimersByTime(INACTIVITY_MS - 500)
    await flushPromises()
    expect(mockLogout).toHaveBeenCalledOnce()
  })

  it('stops the timer when the user signs out externally', async () => {
    await signIn()
    mountTimer()
    const authStore = useAuthStore()

    vi.advanceTimersByTime(5 * 60 * 1000)

    // External sign-out (e.g. another tab)
    authStore.user = null
    await flushPromises()

    vi.advanceTimersByTime(INACTIVITY_MS)
    await flushPromises()
    expect(mockLogout).not.toHaveBeenCalled()
  })

  it('starts the timer when the user signs in after mounting', async () => {
    mountTimer()
    // No user yet — timer not running

    await signIn()
    await flushPromises()

    vi.advanceTimersByTime(INACTIVITY_MS)
    await flushPromises()
    expect(mockLogout).toHaveBeenCalledOnce()
  })
})
