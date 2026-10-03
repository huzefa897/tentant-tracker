import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { authService } from '@/services/auth.service'
import VerifyOtpView from '@/views/VerifyOtpView.vue'

vi.mock('@/services/auth.service', () => ({
  authService: { sendOtp: vi.fn(), verifyOtp: vi.fn(), logout: vi.fn() },
}))

const phoneNumber = '+918341413827'
let view: VueWrapper | undefined

// Starts mid-flow: a code was sent from the login screen.
async function mountView(pendingPhoneNumber = phoneNumber) {
  sessionStorage.setItem('rent-tracker-pending-phone', pendingPhoneNumber)
  const pinia = createPinia()
  setActivePinia(pinia)
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
  localStorage.clear()
  sessionStorage.clear()
  vi.useFakeTimers()
  vi.mocked(authService.sendOtp).mockReset().mockResolvedValue()
  vi.mocked(authService.verifyOtp).mockReset().mockResolvedValue({ id: 'mock-user-1', phoneNumber })
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

    expect(authService.verifyOtp).toHaveBeenCalledWith({ phoneNumber, code: '924636' })
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('stays and shows the error for a wrong code', async () => {
    vi.mocked(authService.verifyOtp).mockRejectedValue(new Error('Invalid verification code'))
    await mountView()

    await typeCode('111111')

    expect(router.currentRoute.value.name).toBe('verify')
    expect(view!.get('[role="alert"]').text()).toBe('Invalid verification code. Please try again.')
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

    expect(authService.sendOtp).toHaveBeenCalledWith({ phoneNumber })
    expect(view!.text()).toContain('A new code has been sent.')
    expect(view!.text()).toContain('Resend code in 01:00')
  })

  it('goes back to login and forgets the number when changing it', async () => {
    await mountView()

    await view!.get('button[aria-label="Use a different number"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
    expect(sessionStorage.getItem('rent-tracker-pending-phone')).toBeNull()
  })
})
