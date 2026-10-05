import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { authService } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'
import { useAuthStore } from '@/stores/auth'
import { resetAuthService } from '@/test/mocks/authService'
import LoginView from '@/views/LoginView.vue'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push('/login')
  return mount(LoginView, { global: { plugins: [pinia, router] }, attachTo: document.body })
}

async function submit(view: Awaited<ReturnType<typeof mountView>>, digits = '8341413827') {
  await view.get('#phone').setValue(digits)
  await view.get('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  resetAuthService()
})

describe('LoginView', () => {
  it('sends a code with a reCAPTCHA host on the page and goes to verify', async () => {
    const view = await mountView()

    await submit(view)

    expect(authService.sendOtp).toHaveBeenCalledWith(
      { phoneNumber: '+918341413827' },
      expect.any(HTMLElement),
    )
    const host = vi.mocked(authService.sendOtp).mock.calls[0]![1]
    expect(view.element.contains(host)).toBe(true)
    expect(router.currentRoute.value.name).toBe('verify')
    view.unmount()
  })

  it('stays on login and shows the error when sending fails', async () => {
    vi.mocked(authService.sendOtp).mockRejectedValue(new Error('down'))
    const view = await mountView()

    await submit(view)

    expect(router.currentRoute.value.name).toBe('login')
    expect(view.get('[role="alert"]').text()).toBe(
      'Unable to send verification code. Please try again.',
    )
    view.unmount()
  })

  it.each([
    ['too-many-requests', 'Too many attempts. Please wait a while and try again.'],
    ['captcha-failed', 'The security check failed. Refresh the page and try again.'],
    ['network', 'No connection. Check your internet and try again.'],
    ['not-configured', "Phone sign-in isn't available right now. Contact the property owner."],
  ] as const)('explains a %s failure', async (code, message) => {
    vi.mocked(authService.sendOtp).mockRejectedValue(new AuthError(code))
    const view = await mountView()

    await submit(view)

    expect(view.get('[role="alert"]').text()).toBe(message)
    view.unmount()
  })

  it('clears a stale error from an earlier attempt on mount', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAuthStore()
    vi.mocked(authService.sendOtp).mockRejectedValueOnce(new Error('down'))
    await store.sendOtp('+918341413827', document.createElement('div')).catch(() => {})

    const view = mount(LoginView, { global: { plugins: [pinia, router] } })
    await flushPromises()

    expect(store.error).toBeNull()
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })

  it('says when sign-in could not start', async () => {
    vi.mocked(authService.onAuthStateChanged).mockImplementation(() => {
      throw new AuthError('not-configured')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = await mountView()
    // The first navigation runs it in the app; the shared test router may already be on /login.
    await useAuthStore().init()
    await flushPromises()

    expect(view.get('[role="alert"]').text()).toBe(
      "Phone sign-in isn't available right now. Contact the property owner.",
    )
    view.unmount()
  })
})
