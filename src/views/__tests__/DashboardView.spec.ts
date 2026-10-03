import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { authService } from '@/services/auth.service'
import { useTenantStore } from '@/stores/tenant'
import DashboardView from '@/views/DashboardView.vue'

vi.mock('@/services/auth.service', () => ({
  authService: { sendOtp: vi.fn(), verifyOtp: vi.fn(), logout: vi.fn() },
}))

let view: VueWrapper | undefined
const body = new DOMWrapper(document.body)

async function mountView() {
  localStorage.setItem(
    'rent-tracker-auth-user',
    JSON.stringify({ id: 'mock-user-1', phoneNumber: '+918341413827' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push('/dashboard')
  view = mount(DashboardView, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return view
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.mocked(authService.logout).mockReset().mockResolvedValue()
})

afterEach(() => {
  view?.unmount()
  view = undefined
})

describe('DashboardView', () => {
  it('loads tenants but shows the empty state until one is selected', async () => {
    await mountView()

    expect(useTenantStore().tenants).toHaveLength(3)
    expect(view!.text()).toContain('Select a tenant')
    expect(view!.find('#tenant-name').exists()).toBe(false)
  })

  it('shows tenant details after choosing a tenant', async () => {
    await mountView()

    await view!.get('button[aria-label="Select tenant"]').trigger('click')
    await flushPromises()
    await body.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()

    expect(useTenantStore().selectedTenantId).toBe('tenant-001')
    expect(view!.get('#tenant-name').text()).toBe('Shaik Zahid Ali')
    expect(view!.text()).not.toContain('Select a tenant')
  })

  it('logs out, clears the selection and returns to login', async () => {
    await mountView()
    useTenantStore().selectTenant('tenant-002')

    await view!.get('button[aria-label="Logout"]').trigger('click')
    await flushPromises()

    expect(authService.logout).toHaveBeenCalled()
    expect(useTenantStore().selectedTenantId).toBeNull()
    expect(localStorage.getItem('rent-tracker-auth-user')).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })
})
