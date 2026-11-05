import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { authService } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'
import { useAuthStore } from '@/stores/auth'
import { resetAuthService } from '@/test/mocks/authService'
import LoginView from '@/views/LoginView.vue'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push('/login')
  return mount(LoginView, { global: { plugins: [pinia, router] }, attachTo: document.body })
}

async function signIn(view: Awaited<ReturnType<typeof mountView>>) {
  await view.get('button').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
})

describe('LoginView', () => {
  it('signs in with Google and goes to the dashboard', async () => {
    const view = await mountView()

    await signIn(view)

    expect(authService.signInWithGoogle).toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('dashboard')
    view.unmount()
  })

  it('stays on login without an error when the person closes Google', async () => {
    vi.mocked(authService.signInWithGoogle).mockRejectedValue(new AuthError('cancelled'))
    const view = await mountView()

    await signIn(view)

    expect(router.currentRoute.value.name).toBe('login')
    expect(view.find('[role="alert"]').exists()).toBe(false)
    view.unmount()
  })

  it('stays on login and shows the error when sign-in fails', async () => {
    vi.mocked(authService.signInWithGoogle).mockRejectedValue(new Error('down'))
    const view = await mountView()

    await signIn(view)

    expect(router.currentRoute.value.name).toBe('login')
    expect(view.get('[role="alert"]').text()).toBe('Unable to sign in. Please try again.')
    view.unmount()
  })

  it.each([
    ['too-many-requests', 'Too many attempts. Please wait a while and try again.'],
    [
      'popup-blocked',
      'Your browser blocked the Google sign-in window. Allow pop-ups and try again.',
    ],
    ['network', 'No connection. Check your internet and try again.'],
    ['not-configured', "Google sign-in isn't available right now. Contact the property owner."],
  ] as const)('explains a %s failure', async (code, message) => {
    vi.mocked(authService.signInWithGoogle).mockRejectedValue(new AuthError(code))
    const view = await mountView()

    await signIn(view)

    expect(view.get('[role="alert"]').text()).toBe(message)
    view.unmount()
  })

  it('clears a stale error from an earlier attempt on mount', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useAuthStore()
    vi.mocked(authService.signInWithGoogle).mockRejectedValueOnce(new Error('down'))
    await store.signInWithGoogle().catch(() => {})

    const view = mount(LoginView, { global: { plugins: [pinia, router] } })
    await flushPromises()

    expect(store.error).toBeNull()
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })

  it('explains why the user was signed out', async () => {
    const view = await mountView()

    await useAuthStore().endSession(
      "This Google account isn't registered. Contact the property owner to be added.",
    )
    await flushPromises()

    expect(view.get('[role="alert"]').text()).toBe(
      "This Google account isn't registered. Contact the property owner to be added.",
    )
    view.unmount()
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
      "Google sign-in isn't available right now. Contact the property owner.",
    )
    view.unmount()
  })
})
