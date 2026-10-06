import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { authService } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'
import { useAuthStore } from '@/stores/auth'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, testUser } from '@/test/mocks/authService'
import VerifyOtpView from '@/views/VerifyOtpView.vue'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))

const phoneNumber = '+918341413827'
let view: VueWrapper | undefined

// Starts mid-flow: a code was sent from the login screen.
async function mountView(pendingPhoneNumber = phoneNumber) {
  const pinia = createPinia()
  setActivePinia(pinia)
  await useAuthStore().sendOtp(pendingPhoneNumber, document.createElement('div'))
  vi.mocked(authService.sendOtp).mockClear()
  await router.push('/verify')
  view = mount(VerifyOtpView, { global: { plugins: [pinia, router] }, attachTo: document.body })
  return view
}

async function typeCode(code: string) {
  const slots = view!.findAll('[data-slot="pin-input-slot"]')
  for (const [index, digit] of [...code].entries()) {
    await slots[index]!.setValue(digit)
  }
  await flushPromises()
}

function resendButton() {
  return view!.findAll('button').find((button) => button.text() === 'Resend code')
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
  vi.useFakeTimers()
})

afterEach(() => {
  view?.unmount()
  view = undefined
  vi.useRealTimers()
})

describe('VerifyOtpView', () => {
  it('shows the number the code was sent to', async () => {
    await mountView()

    expect(view!.text()).toContain('+91 83414 13827')
  })

  it('formats a number from another supported country', async () => {
    await mountView('+61412345678')

    expect(view!.text()).toContain('+61 412 345 678')
  })

  it('verifies the code and goes to the dashboard', async () => {
    await mountView()

    await typeCode('924636')

    expect(authService.verifyOtp).toHaveBeenCalledWith({ code: '924636' })
    expect(useAuthStore().user).toEqual(testUser)
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('stays and shows the error for a wrong code', async () => {
    vi.mocked(authService.verifyOtp).mockRejectedValue(new AuthError('invalid-code'))
    await mountView()

    await typeCode('111111')

    expect(router.currentRoute.value.name).toBe('verify')
    expect(view!.get('[role="alert"]').text()).toBe('Invalid verification code. Please try again.')
  })

  it('asks for a new code when the code has expired', async () => {
    vi.mocked(authService.verifyOtp).mockRejectedValue(new AuthError('code-expired'))
    await mountView()

    await typeCode('111111')

    expect(view!.get('[role="alert"]').text()).toBe('This code has expired. Request a new one.')
  })

  it('counts down before allowing a resend', async () => {
    await mountView()

    expect(view!.text()).toContain('Resend code in 01:00')
    expect(resendButton()).toBeUndefined()

    await vi.advanceTimersByTimeAsync(59_000)
    expect(view!.text()).toContain('Resend code in 00:01')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(resendButton()).toBeDefined()
  })

  it('resends the code and restarts the countdown', async () => {
    await mountView()
    await vi.advanceTimersByTimeAsync(60_000)

    await resendButton()!.trigger('click')
    await flushPromises()

    expect(authService.sendOtp).toHaveBeenCalledWith({ phoneNumber }, expect.any(HTMLElement))
    expect(view!.text()).toContain('A new code has been sent.')
    expect(view!.text()).toContain('Resend code in 01:00')
  })

  it('shows that a new code is being sent while resending', async () => {
    await mountView()
    await vi.advanceTimersByTimeAsync(60_000)
    let finish: () => void = () => {}
    vi.mocked(authService.sendOtp).mockReturnValue(
      new Promise<void>((resolve) => (finish = resolve)),
    )

    await resendButton()!.trigger('click')

    const status = view!.get('[role="status"]')
    expect(status.text()).toContain('Sending a new code…')
    expect(status.find('svg.animate-spin').exists()).toBe(true)
    expect(resendButton()).toBeUndefined()

    finish()
    await flushPromises()
    expect(status.text()).not.toContain('Sending a new code…')
  })

  it('goes back to login and forgets the number when changing it', async () => {
    await mountView()

    await view!.get('button[aria-label="Use a different number"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
    expect(useAuthStore().pendingPhoneNumber).toBeNull()
  })

  it('starts over after a refresh, since the pending code lives in memory', async () => {
    setActivePinia(createPinia())

    await router.push('/verify')

    expect(router.currentRoute.value.name).toBe('login')
  })
})
