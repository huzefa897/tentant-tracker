import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { receiptService } from '@/services/receipt.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { tenantService } from '@/services/tenant.service'
import { authService } from '@/services/auth.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { ENTRIES_LOAD_ERROR_MESSAGE, useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeReceipts } from '@/test/mocks/receiptService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { makeEntry, makePayment } from '@/test/rentEntries'
import { downloadReceiptPdf } from '@/utils/receiptDownload'
import DashboardView from '@/views/DashboardView.vue'
import { SEARCH_DEBOUNCE_MS } from '@/components/tenant/TenantSelector.vue'
import { TENANTS_LOAD_ERROR_MESSAGE } from '@/stores/tenant'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
vi.mock('@/services/receipt.service', () => import('@/test/mocks/receiptService'))
vi.mock('@/utils/receiptDownload', () => ({ downloadReceiptPdf: vi.fn() }))

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
  resetTenantService()
  resetAuthService()
  resetAccessService()
  resetRentEntryService()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  view?.unmount()
  view = undefined
  vi.useRealTimers()
})

describe('DashboardView', () => {
  it('loads tenants but shows the empty state until one is selected', async () => {
    await mountView()

    expect(useTenantStore().results).toHaveLength(3)
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

  describe('tenants from the backend', () => {
    async function openSelector() {
      await view!.get('button[aria-label="Select tenant"]').trigger('click')
      await flushPromises()
    }

    async function typeSearch(query: string) {
      await body.get('input[aria-label="Search tenants"]').setValue(query)
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
      await flushPromises()
    }

    function optionNames() {
      return body.findAll('[role="option"]').map((option) => option.get('p').text())
    }

    it('loads the selected property’s tenants', async () => {
      await mountView()

      expect(tenantService.getTenants).toHaveBeenCalledWith(testProperty.id, { search: '' })
    })

    it('searches through the API as the user types', async () => {
      await mountView()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await openSelector()

      await typeSearch('zahid')

      expect(tenantService.getTenants).toHaveBeenLastCalledWith(testProperty.id, {
        search: 'zahid',
      })
      expect(optionNames()).toEqual(['Shaik Zahid Ali'])
    })

    it('keeps the selected tenant’s details while searching for another', async () => {
      await mountView()
      useTenantStore().selectTenant('tenant-001')
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await openSelector()

      await typeSearch('yusuf')

      expect(optionNames()).toEqual(['Mohammed Yusuf'])
      expect(view!.get('#tenant-name').text()).toBe('Shaik Zahid Ali')
    })

    it('starts from the full list when the dashboard opens again', async () => {
      await mountView(async () => {
        await useAuthStore().init()
        await useAccessStore().load()
        await useTenantStore().searchTenants('zahid')
      })

      expect(useTenantStore().query).toBe('')
      expect(useTenantStore().results).toHaveLength(3)
    })

    it('shows a failed load with Retry, then the tenants', async () => {
      vi.mocked(tenantService.getTenants).mockRejectedValueOnce(new Error('boom'))
      await mountView()

      expect(view!.get('[data-testid="tenants-error"]').text()).toContain(
        TENANTS_LOAD_ERROR_MESSAGE,
      )

      await view!
        .get('[data-testid="tenants-error"]')
        .findAll('button')
        .find((b) => b.text() === 'Retry')!
        .trigger('click')
      await flushPromises()

      expect(view!.find('[data-testid="tenants-error"]').exists()).toBe(false)
      expect(useTenantStore().results).toHaveLength(3)
    })
  })

  describe('saved entries', () => {
    function previousEntriesText() {
      return view!
        .findAll('button')
        .find((b) => b.text().startsWith('Previous Entries'))!
        .text()
    }

    function saveEntries(...months: string[]) {
      fakeEntries.entries = months.map((billingMonth, index) =>
        makeEntry({ id: `entry-${index}`, billingMonth }),
      )
    }

    it('shows the selected tenant’s bill count from the API', async () => {
      saveEntries('2026-08', '2026-09')
      await mountView()

      useTenantStore().selectTenant('tenant-001')
      await flushPromises()
      expect(vi.mocked(rentEntryService.getEntries)).toHaveBeenCalledWith(
        testProperty.id,
        'tenant-001',
      )
      expect(previousEntriesText()).toBe('Previous Entries (2)')

      useTenantStore().selectTenant('tenant-002')
      await flushPromises()
      expect(previousEntriesText()).toBe('Previous Entries (0)')
    })

    it('shows a load error with Retry instead of a count or latest entry', async () => {
      saveEntries('2026-09')
      vi.mocked(rentEntryService.getEntries).mockRejectedValueOnce(new ApiError('unknown'))
      await mountView()
      useTenantStore().selectTenant('tenant-001')
      await flushPromises()

      expect(view!.get('[data-testid="entries-error"]').text()).toContain(
        ENTRIES_LOAD_ERROR_MESSAGE,
      )
      expect(previousEntriesText()).toBe('Previous Entries')
      expect(view!.find('[aria-labelledby="latest-entry-heading"]').exists()).toBe(false)

      await view!
        .get('[data-testid="entries-error"]')
        .findAll('button')
        .find((b) => b.text() === 'Retry')!
        .trigger('click')
      await flushPromises()

      expect(view!.find('[data-testid="entries-error"]').exists()).toBe(false)
      expect(previousEntriesText()).toBe('Previous Entries (1)')
    })

    it('shows the selected tenant’s latest entry below the name', async () => {
      fakeEntries.entries = [
        makeEntry({ id: 'entry-aug', billingMonth: '2026-08' }),
        makeEntry({ id: 'entry-oct', billingMonth: '2026-10', waterAmount: 0 }),
        makeEntry({ id: 'entry-sep', billingMonth: '2026-09' }),
      ]
      await mountView()
      useTenantStore().selectTenant('tenant-001')
      await flushPromises()

      const card = view!.get('[aria-labelledby="latest-entry-heading"]')
      expect(card.get('h3').text()).toBe('October 2026')
      expect(card.text()).toContain('₹15,450')
      expect(card.text()).toContain('Unpaid')

      await card.get('button').trigger('click')
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
      expect(router.currentRoute.value.params).toEqual({
        tenantId: 'tenant-001',
        entryId: 'entry-oct',
      })
      // So the summary's back button returns to the dashboard.
      expect(router.currentRoute.value.query).toEqual({ from: 'dashboard' })
    })

    describe('the latest entry’s receipt', () => {
      beforeEach(async () => {
        vi.mocked(downloadReceiptPdf).mockReset().mockResolvedValue()
        fakeEntries.entries = [makeEntry({ id: 'entry-oct', billingMonth: '2026-10' })]
        addFakePayment(makePayment({ id: 'p-1', entryId: 'entry-oct', paidDate: '2026-10-03' }))
        addFakePayment(
          makePayment({ id: 'p-2', entryId: 'entry-oct', amount: 2000, paidDate: '2026-10-05' }),
        )
        await mountView()
        useTenantStore().selectTenant('tenant-001')
        await flushPromises()
      })

      function receiptButton() {
        return view!.get('[data-testid="download-entry-receipt"]')
      }

      it('downloads the receipt for the bill’s most recent payment', async () => {
        await receiptButton().trigger('click')
        await flushPromises()

        expect(receiptService.issueReceipt).toHaveBeenCalledWith(
          expect.any(String),
          'tenant-001',
          'entry-oct',
          'p-2',
        )
        expect(downloadReceiptPdf).toHaveBeenCalledWith(fakeReceipts.get('p-2'))
        expect(fakeReceipts.get('p-2')).toMatchObject({ paymentAmount: 2000 })
        expect(view!.find('[data-testid="receipt-error"]').exists()).toBe(false)
      })

      it('shows why a receipt can’t be issued', async () => {
        vi.mocked(receiptService.issueReceipt).mockRejectedValueOnce(
          new ApiError('invalid-request', 'x', 'receipt_configuration_incomplete', {
            detail: 'Configure the property address before issuing receipts.',
          }),
        )

        await receiptButton().trigger('click')
        await flushPromises()

        expect(view!.get('[data-testid="receipt-error"]').text()).toBe(
          'Configure the property address before issuing receipts.',
        )
        expect(downloadReceiptPdf).not.toHaveBeenCalled()
      })
    })

    it('shows no latest entry for a tenant without entries', async () => {
      saveEntries('2026-09')
      await mountView()
      useTenantStore().selectTenant('tenant-002')
      await flushPromises()

      expect(view!.find('[aria-labelledby="latest-entry-heading"]').exists()).toBe(false)
      expect(previousEntriesText()).toBe('Previous Entries (0)')
    })

    it('reloads the latest entry when returning with a tenant selected', async () => {
      await mountView()
      useTenantStore().selectTenant('tenant-001')
      await flushPromises()
      expect(view!.find('[aria-labelledby="latest-entry-heading"]').exists()).toBe(false)

      // Saved elsewhere (e.g. the new-entry page) while away.
      saveEntries('2026-10')
      view!.unmount()
      view = mount(DashboardView, {
        global: { plugins: [router] },
        attachTo: document.body,
      })
      await flushPromises()

      expect(view.get('[aria-labelledby="latest-entry-heading"] h3').text()).toBe('October 2026')
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

  it('forgets loaded bills on logout', async () => {
    fakeEntries.entries = [makeEntry({ billingMonth: '2026-09' })]
    await mountView()
    useTenantStore().selectTenant('tenant-001')
    await flushPromises()
    expect(useRentEntryStore().summaries['tenant-001']).toBeDefined()

    await view!.get('button[aria-label="Logout"]').trigger('click')
    await flushPromises()

    expect(useRentEntryStore().summaries).toEqual({})
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

    it('clears the selected tenant when the property changes', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
      await mountView(async () => {
        await useAuthStore().init()
        await useAccessStore().load()
        useAccessStore().selectProperty(testProperty.id)
      })
      useTenantStore().selectTenant('tenant-001')
      await flushPromises()
      expect(view!.find('#tenant-name').exists()).toBe(true)

      useAccessStore().selectProperty(annex.id)
      await flushPromises()

      expect(useTenantStore().selectedTenant).toBeNull()
      expect(view!.find('#tenant-name').exists()).toBe(false)
      expect(view!.text()).toContain('Select a tenant')
    })
  })
})
