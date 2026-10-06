import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import { RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { authService } from '@/services/auth.service'
import { useAccessStore } from '@/stores/access'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))

const annex = {
  id: '6f1c2a4e-0000-4000-8000-000000000002',
  name: 'Annex',
  role: 'manager' as const,
}
let view: VueWrapper | undefined

async function open(path = '/properties', query: Record<string, string> = {}) {
  signInAs()
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push({ path, query, force: true })
  view = mount(() => h(RouterView), {
    global: { plugins: [pinia, router] },
    attachTo: document.body,
  })
  await flushPromises()
  return view
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
})

afterEach(() => {
  view?.unmount()
  view = undefined
})

describe('PropertySelectView', () => {
  it('explains that access is not configured, with the signed-in number', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(identityWith([]))

    await open()

    const panel = view!.get('[data-testid="no-property-access"]')
    expect(panel.text()).toContain(
      'Your account has no property access. Contact the property owner.',
    )
    expect(panel.text()).toContain('+91 83414 13827')
  })

  it('shows a load failure with Retry, not as missing access', async () => {
    vi.mocked(accessService.getMe).mockRejectedValueOnce(new ApiError('unavailable'))

    await open()

    expect(view!.get('[role="alert"]').text()).toContain(
      "Sign-in couldn't be checked right now. Please try again shortly.",
    )
    expect(view!.find('[data-testid="no-property-access"]').exists()).toBe(false)

    await view!
      .findAll('button')
      .find((b) => b.text() === 'Retry')!
      .trigger('click')
    await flushPromises()

    expect(view!.find('[role="alert"]').exists()).toBe(false)
    expect(view!.text()).toContain('Test Towers')
  })

  it('shows a loading state until access has loaded', async () => {
    vi.mocked(accessService.getMe).mockReturnValue(new Promise(() => {}))
    signInAs()
    setActivePinia(createPinia())
    await router.push({ path: '/properties', force: true })
    view = mount(() => h(RouterView), { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()

    expect(view.get('[role="status"]').text()).toContain('Loading your properties…')
  })

  it('selects a property and continues to where the user was going', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))

    await open('/tenants/tenant-001/entries')
    expect(router.currentRoute.value.name).toBe('property-select')

    await view!
      .findAll('button')
      .find((b) => b.text().startsWith('Annex'))!
      .trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
    expect(useAccessStore().selectedProperty).toEqual(annex)
  })

  it('goes to the dashboard without a redirect, ignoring other origins', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))

    await open('/properties', { redirect: '//evil.example' })
    await view!
      .findAll('button')
      .find((b) => b.text().startsWith('Annex'))!
      .trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('dashboard'))
  })

  it('logs out', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(identityWith([]))
    await open()

    await view!.get('button[aria-label="Logout"]').trigger('click')
    await flushPromises()

    expect(authService.logout).toHaveBeenCalled()
    expect(useAccessStore().status).toBe('idle')
    expect(router.currentRoute.value.name).toBe('login')
  })
})
