import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App.vue'
import router from '@/router'
import { authService } from '@/services/auth.service'
import { useAccessStore } from '@/stores/access'
import { useTenantStore } from '@/stores/tenant'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, testUser } from '@/test/mocks/authService'
import type { AuthUser } from '@/types/auth'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))

let notify: (user: AuthUser | null) => void = () => {}

async function openDashboard() {
  vi.mocked(authService.onAuthStateChanged).mockImplementation((listener) => {
    notify = listener
    listener(testUser)
    return () => {}
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push({ path: '/dashboard', force: true })
  const app = mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  useTenantStore().selectTenant('tenant-001')
  return app
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
})

describe('App', () => {
  it('leaves protected pages and clears per-user state when Firebase ends the session', async () => {
    const app = await openDashboard()

    notify(null)
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('login')
    expect(useAccessStore().identity).toBeNull()
    expect(useTenantStore().selectedTenantId).toBeNull()
    app.unmount()
  })

  it('clears the previous user’s state when another account signs in', async () => {
    const app = await openDashboard()

    notify({ id: 'someone-else', phoneNumber: '+61412345678' })
    await flushPromises()

    expect(useAccessStore().identity).toBeNull()
    expect(useTenantStore().selectedTenantId).toBeNull()
    app.unmount()
  })
})
