import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { authService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth'
import LoginView from '@/views/LoginView.vue'

vi.mock('@/services/auth.service', () => ({
  authService: { sendOtp: vi.fn(), verifyOtp: vi.fn(), logout: vi.fn() },
}))

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push('/login')
  return mount(LoginView, { global: { plugins: [pinia, router] } })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.mocked(authService.sendOtp).mockReset().mockResolvedValue()
})

describe('LoginView', () => {
  it('sends a code and goes to verify', async () => {
    const view = await mountView()

    await view.get('#phone').setValue('8341413827')
    await view.get('form').trigger('submit')
    await flushPromises()

    expect(authService.sendOtp).toHaveBeenCalledWith({ phoneNumber: '+918341413827' })
    expect(router.currentRoute.value.name).toBe('verify')
  })

  it('stays on login and shows the error when sending fails', async () => {
    vi.mocked(authService.sendOtp).mockRejectedValue(new Error('down'))
    const view = await mountView()

    await view.get('#phone').setValue('8341413827')
    await view.get('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
    expect(view.get('[role="alert"]').text()).toBe(
      'Unable to send verification code. Please try again.',
    )
  })

  it('clears a stale error from an earlier attempt on mount', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAuthStore()
    vi.mocked(authService.sendOtp).mockRejectedValueOnce(new Error('down'))
    await store.sendOtp('+918341413827').catch(() => {})

    const view = mount(LoginView, { global: { plugins: [pinia, router] } })
    await flushPromises()

    expect(store.error).toBeNull()
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })
})
