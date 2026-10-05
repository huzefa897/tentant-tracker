import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { accessService } from '@/services/access.service'
import { authService } from '@/services/auth.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { LOAD_ERROR_MESSAGE } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { RENT_LEDGER_STORAGE_KEY } from '@/utils/rentLedgerStorage'
import DashboardView from '@/views/DashboardView.vue'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))

let view: VueWrapper | undefined
const body = new DOMWrapper(document.body)

// beforeOpen runs with the fresh pinia active, before navigating to the dashboard.
async function mountView(beforeOpen?: () => Promise<void>) {
  signInAs()
  const pinia = createPinia()
  setActivePinia(pinia)
  await beforeOpen?.()
  await router.push('/dashboard')
  view = mount(DashboardView, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return view
}

beforeEach(() => {
  resetAuthService()
  resetAccessService()
  localStorage.clear()
  sessionStorage.clear()
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

  it('opens a new entry for the selected tenant', async () => {
    await mountView()
    useTenantStore().selectTenant('tenant-002')
    await flushPromises()

    const addEntry = view!.findAll('button').find((button) => button.text() === 'Add New Entry')
    await addEntry!.trigger('click')

    // The entry page is lazy loaded, so navigation finishes after its chunk is imported.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-new'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-002')
  })

  it('opens the selected tenant’s previous entries', async () => {
    await mountView()
    useTenantStore().selectTenant('tenant-002')
    await flushPromises()

    const previousEntries = view!
      .findAll('button')
      .find((button) => button.text().startsWith('Previous Entries'))
    await previousEntries!.trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-002')
  })

  describe('saved entries', () => {
    function previousEntriesText() {
      return view!
        .findAll('button')
        .find((b) => b.text().startsWith('Previous Entries'))!
        .text()
    }

    function storeEntries(...months: string[]) {
      localStorage.setItem(
        RENT_LEDGER_STORAGE_KEY,
        JSON.stringify({
          version: 2,
          payments: [],
          entries: months.map((billingMonth, index) => ({
            id: `entry-${index}`,
            tenantId: 'tenant-001',
            billingMonth,
            rentAmount: 15000,
            electricityUnits: 75,
            electricityRate: 6,
            waterAmount: 300,
            notes: '',
            createdAt: '2026-10-03T06:00:00.000Z',
          })),
        }),
      )
    }

    it('shows the selected tenant’s saved entry count', async () => {
      storeEntries('2026-08', '2026-09')
      await mountView()

      useTenantStore().selectTenant('tenant-001')
      await flushPromises()
      expect(previousEntriesText()).toBe('Previous Entries (2)')

      useTenantStore().selectTenant('tenant-002')
      await flushPromises()
      expect(previousEntriesText()).toBe('Previous Entries (0)')
    })

    it('shows a load error with Retry instead of a count when entries are corrupt', async () => {
      localStorage.setItem(RENT_LEDGER_STORAGE_KEY, 'corrupt')
      await mountView()
      useTenantStore().selectTenant('tenant-001')
      await flushPromises()

      expect(view!.text()).toContain(LOAD_ERROR_MESSAGE)
      expect(previousEntriesText()).toBe('Previous Entries')
      expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe('corrupt')

      storeEntries('2026-09')
      await view!
        .findAll('button')
        .find((b) => b.text() === 'Retry')!
        .trigger('click')
      await flushPromises()

      expect(view!.text()).not.toContain(LOAD_ERROR_MESSAGE)
      expect(previousEntriesText()).toBe('Previous Entries (1)')
    })

    it('keeps saved entries across logout and login', async () => {
      storeEntries('2026-09')
      await mountView()

      await view!.get('button[aria-label="Logout"]').trigger('click')
      await flushPromises()
      view!.unmount()

      await mountView()
      useTenantStore().selectTenant('tenant-001')
      await flushPromises()

      expect(previousEntriesText()).toBe('Previous Entries (1)')
    })
  })

  it('logs out, clears the selection and returns to login', async () => {
    await mountView()
    useTenantStore().selectTenant('tenant-002')

    await view!.get('button[aria-label="Logout"]').trigger('click')
    await flushPromises()

    expect(authService.logout).toHaveBeenCalled()
    expect(useTenantStore().selectedTenantId).toBeNull()
    expect(useAccessStore().selectedPropertyId).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('keeps saved entries on logout (they are not per user yet)', async () => {
    localStorage.setItem(RENT_LEDGER_STORAGE_KEY, 'kept')
    await mountView()

    await view!.get('button[aria-label="Logout"]').trigger('click')
    await flushPromises()

    expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe('kept')
  })

  describe('property', () => {
    const annex = {
      id: '6f1c2a4e-0000-4000-8000-000000000002',
      name: 'Annex',
      role: 'manager' as const,
    }

    it('shows the selected property', async () => {
      await mountView()

      expect(view!.get('[data-testid="selected-property"]').text()).toBe('Test Towers')
    })

    it('offers no property switch with a single property', async () => {
      await mountView()

      expect(view!.find('button[aria-label="Switch property"]').exists()).toBe(false)
    })

    it('switches property when there are several', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
      // Chosen on the property page first.
      await mountView(async () => {
        await useAuthStore().init()
        await useAccessStore().load()
        useAccessStore().selectProperty(annex.id)
      })
      expect(view!.get('[data-testid="selected-property"]').text()).toBe('Annex')

      await view!.get('button[aria-label="Switch property"]').trigger('click')

      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('property-select'))
    })
  })
})
