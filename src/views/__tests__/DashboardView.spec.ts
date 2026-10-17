import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { dashboardService } from '@/services/dashboard.service'
import { receiptService } from '@/services/receipt.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { tenantService } from '@/services/tenant.service'
import { authService } from '@/services/auth.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { openUserMenu } from '@/test/userMenu'
import { fakeReceipts } from '@/test/mocks/receiptService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { makeEntry, makePayment } from '@/test/rentEntries'
import { downloadReceiptPdf } from '@/utils/receiptDownload'
import DashboardView from '@/views/DashboardView.vue'
import { SEARCH_DEBOUNCE_MS } from '@/components/tenant/TenantSelector.vue'
import { resetTenantService } from '@/test/mocks/tenantService'
import {
  fakeDashboard,
  makeOverdueBill,
  makeOverdueTenant,
  makeSummary,
  makeUnbilledPeriod,
} from '@/test/mocks/dashboardService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
vi.mock('@/services/receipt.service', () => import('@/test/mocks/receiptService'))
vi.mock('@/utils/receiptDownload', () => ({ downloadReceiptPdf: vi.fn() }))

let view: VueWrapper | undefined
const body = new DOMWrapper(document.body)
// Where the dashboard opens: rent due, unless a describe chooses overdue bills.
const OVERDUE = '/dashboard?view=overdue'
let openAt = '/dashboard'

// beforeOpen runs with the fresh pinia active, before navigating to the dashboard.
async function mountView(beforeOpen?: () => Promise<void>) {
  signInAs()
  const pinia = createPinia()
  setActivePinia(pinia)
  await beforeOpen?.()
  await router.push(openAt)
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
  openAt = '/dashboard'
  vi.useRealTimers()
})

describe('DashboardView', () => {
  it('loads tenants but opens on rent due until one is selected', async () => {
    await mountView()

    expect(useTenantStore().results).toHaveLength(3)
    expect(view!.get('h1').text()).toBe('Rent due')
    expect(view!.findAll('[data-testid^="dashboard-tab-"]').map((tab) => tab.text())).toEqual([
      'Rent due',
      'Overdue bills',
    ])
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
    expect(view!.find('[data-testid="pending-payments"]').exists()).toBe(false)
  })

  it('opens a new entry for the selected tenant', async () => {
    await mountView()
    useTenantStore().selectTenant('tenant-002')
    await flushPromises()

    const addEntry = view!.findAll('button').find((button) => button.text() === 'New bill')
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
      .find((button) => button.text().startsWith('Bills'))
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

    it('auto-retries a failed tenant load silently, then shows tenants', async () => {
      vi.useFakeTimers()
      try {
        vi.mocked(tenantService.getTenants).mockRejectedValueOnce(new Error('boom'))
        await mountView()

        expect(view!.find('[data-testid="tenants-error"]').exists()).toBe(false)

        vi.advanceTimersByTime(5000)
        await flushPromises()

        expect(useTenantStore().results).toHaveLength(3)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('saved entries', () => {
    function previousEntriesText() {
      return view!
        .findAll('button')
        .find((b) => b.text().startsWith('Bills'))!
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
      expect(previousEntriesText()).toBe('Bills (2)')

      useTenantStore().selectTenant('tenant-002')
      await flushPromises()
      expect(previousEntriesText()).toBe('Bills (0)')
    })

    it('shows a skeleton instead of a count or latest entry on error, then auto-retries', async () => {
      vi.useFakeTimers()
      try {
        saveEntries('2026-09')
        vi.mocked(rentEntryService.getEntries).mockRejectedValueOnce(new ApiError('unknown'))
        await mountView()
        useTenantStore().selectTenant('tenant-001')
        await flushPromises()

        expect(view!.find('[data-testid="entries-error"]').exists()).toBe(false)
        expect(previousEntriesText()).toBe('Bills')
        expect(view!.find('[data-testid="latest-entry-loading"]').exists()).toBe(true)

        vi.advanceTimersByTime(5000)
        await flushPromises()

        expect(previousEntriesText()).toBe('Bills (1)')
        expect(view!.find('[data-testid="latest-entry-loading"]').exists()).toBe(false)
      } finally {
        vi.useRealTimers()
      }
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

      it('never shows an earlier tenant’s receipt error, or makes the next tenant wait', async () => {
        fakeEntries.entries.push(
          makeEntry({ id: 'entry-t2', tenantId: 'tenant-002', billingMonth: '2026-10' }),
        )
        addFakePayment(makePayment({ id: 'p-t2', entryId: 'entry-t2', paidDate: '2026-10-04' }))
        let fail!: (error: unknown) => void
        vi.mocked(receiptService.issueReceipt).mockImplementationOnce(
          () => new Promise((_, reject) => (fail = reject)),
        )
        await receiptButton().trigger('click')
        await flushPromises()

        useTenantStore().selectTenant('tenant-002')
        await flushPromises()
        fail(new ApiError('forbidden'))
        await flushPromises()

        expect(view!.find('[data-testid="receipt-error"]').exists()).toBe(false)
        expect(receiptButton().attributes('disabled')).toBeUndefined()
        expect(receiptButton().text()).toBe('Download receipt')
      })
    })

    it('holds the latest entry’s place with a skeleton while bills load', async () => {
      fakeEntries.entries = [makeEntry({ id: 'entry-oct', billingMonth: '2026-10' })]
      await mountView()
      vi.mocked(rentEntryService.getEntries).mockReturnValueOnce(new Promise(() => {}))
      useTenantStore().selectTenant('tenant-001')
      await flushPromises()

      expect(view!.get('[data-testid="latest-entry-loading"]').text()).toBe(
        'Loading the latest bill…',
      )
      expect(view!.find('[aria-labelledby="latest-entry-heading"]').exists()).toBe(false)
    })

    it('shows no latest entry for a tenant without entries', async () => {
      saveEntries('2026-09')
      await mountView()
      useTenantStore().selectTenant('tenant-002')
      await flushPromises()

      expect(view!.find('[aria-labelledby="latest-entry-heading"]').exists()).toBe(false)
      expect(previousEntriesText()).toBe('Bills (0)')
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

    await openUserMenu()
    await new DOMWrapper(document.body).get('[data-testid="user-menu-logout"]').trigger('click')
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

    await openUserMenu()
    await new DOMWrapper(document.body).get('[data-testid="user-menu-logout"]').trigger('click')
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

      await openUserMenu()
      expect(
        new DOMWrapper(document.body).find('[data-testid="user-menu-switch-property"]').exists(),
      ).toBe(false)
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

      await openUserMenu()
      await new DOMWrapper(document.body)
        .get('[data-testid="user-menu-switch-property"]')
        .trigger('click')

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
      expect(view!.find('[data-testid="pending-payments"]').exists()).toBe(true)
    })

    it('loads the new property’s rent due', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
      await mountView(async () => {
        await useAuthStore().init()
        await useAccessStore().load()
        useAccessStore().selectProperty(testProperty.id)
      })

      useAccessStore().selectProperty(annex.id)
      await flushPromises()

      expect(dashboardService.getSummary).toHaveBeenLastCalledWith(annex.id)
    })
  })

  describe('rent due', () => {
    function shownMonths() {
      return view!
        .findAll('[data-testid="period-row"]')
        .map((row) => `${row.get('th').text()} ${row.findAll('td')[1]!.text()}`)
    }

    function rowButton(label: string, index = 0) {
      return view!
        .findAll('[data-testid="period-row"] button')
        .filter((button) => button.attributes('aria-label')?.startsWith(label))[index]!
    }

    it('shows the summary and the months due, bill or no bill, from the backend', async () => {
      await mountView()

      expect(view!.get('[data-testid="summary-known-outstanding"]').text()).toBe('₹5,750')
      expect(view!.get('[data-testid="summary-overdue"]').text()).toContain('2 months')
      expect(view!.get('[data-testid="summary-excluded"]').text()).toContain(
        '2 months awaiting a bill',
      )
      expect(shownMonths()).toEqual([
        'Mohammed Yusuf August 2026',
        'Shaik Zahid Ali September 2026',
      ])
      expect(view!.get('[data-testid="awaiting-bill"]').text()).toBe('Bill not prepared')
      expect(view!.get('[data-testid="updated-at"]').text()).toBe('Updated just now')
    })

    it('counts each timing’s months on its tab until another filter narrows the list', async () => {
      await mountView()
      const counts = () =>
        view!.findAll('[data-testid="timing-count"]').map((count) => count.text())

      // The summary: 2 overdue, none due today, 1 in the next 7 days.
      expect(counts()).toEqual(['2', '2', '0', '1'])
      expect(view!.get('caption').text()).toBe(
        'Rental months due now (overdue or due today), oldest due first',
      )

      await view!.get('[data-testid="filter-preparation"]').setValue('not_prepared')
      await flushPromises()

      expect(counts()).toEqual([])
      expect(view!.get('caption').text()).toBe(
        'Rental months due now (overdue or due today), awaiting a bill, oldest due first',
      )
    })

    it('prepares a missing bill on its month', async () => {
      await mountView()

      await rowButton('Prepare bill').trigger('click')

      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-new'))
      expect(router.currentRoute.value.params.tenantId).toBe('tenant-002')
      expect(router.currentRoute.value.query.month).toBe('2026-08')
    })

    it('opens a prepared bill, or opens it to record a payment', async () => {
      await mountView()

      await rowButton('Record payment').trigger('click')

      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
      expect(router.currentRoute.value.params).toMatchObject({
        tenantId: 'tenant-001',
        entryId: 'entry-001',
      })
      expect(router.currentRoute.value.query).toEqual({ from: 'dashboard', pay: '1' })
    })

    it('filters the list, leaving the summary alone', async () => {
      await mountView()

      await view!.get('[data-testid="timing-filter-upcoming"]').trigger('click')
      await flushPromises()

      expect(dashboardService.getRentalPeriods).toHaveBeenLastCalledWith(
        expect.any(String),
        { timing: 'upcoming', preparation: 'all', month: null },
        1,
      )
      expect(dashboardService.getSummary).toHaveBeenCalledTimes(1)
      expect(shownMonths()).toEqual(['Mohammed Yusuf September 2026'])

      await view!.get('[data-testid="filter-preparation"]').setValue('prepared')
      await flushPromises()

      expect(view!.get('[data-testid="periods-empty"]').text()).toBe(
        'No months match these filters.',
      )

      await view!
        .findAll('button')
        .find((b) => b.text() === 'Clear filters')!
        .trigger('click')
      await flushPromises()

      expect(shownMonths()).toEqual(['Mohammed Yusuf September 2026'])
    })

    it('says plainly when nothing is due', async () => {
      fakeDashboard.periods = []
      await mountView()

      expect(view!.get('[data-testid="periods-empty"]').text()).toBe('No rent is due or overdue.')
    })

    it('marks a month not owed after asking why, then refreshes', async () => {
      fakeDashboard.periods = [makeUnbilledPeriod({ actions: ['prepare_bill', 'mark_not_owed'] })]
      await mountView()

      await rowButton('Mark not owed').trigger('click')
      await flushPromises()
      await body.get('#not-owed-reason').setValue('Settled in the old sheet')
      await body.get('[role="dialog"] form').trigger('submit')
      await flushPromises()

      expect(dashboardService.markNotOwed).toHaveBeenCalledWith(
        testProperty.id,
        'period-002',
        'Settled in the old sheet',
      )
      expect(body.find('[role="dialog"]').exists()).toBe(false)
      expect(dashboardService.getSummary).toHaveBeenCalledTimes(2)
      expect(view!.find('[data-testid="periods-empty"]').exists()).toBe(true)
    })

    it('keeps the dialog open with the reason when marking fails', async () => {
      fakeDashboard.periods = [makeUnbilledPeriod({ actions: ['prepare_bill', 'mark_not_owed'] })]
      vi.mocked(dashboardService.markNotOwed).mockRejectedValueOnce(
        new ApiError('conflict', 'x', 'period_has_bill'),
      )
      await mountView()

      await rowButton('Mark not owed').trigger('click')
      await flushPromises()
      await body.get('#not-owed-reason').setValue('Waived')
      await body.get('[role="dialog"] form').trigger('submit')
      await flushPromises()

      expect(body.get('[role="dialog"]').text()).toContain(
        'This month has a bill. Void the bill first.',
      )
      expect((body.get('#not-owed-reason').element as HTMLTextAreaElement).value).toBe('Waived')
    })

    it('keeps what it shows, with its time, when a refresh fails, and stays signed in', async () => {
      await mountView()
      vi.mocked(dashboardService.getSummary).mockRejectedValueOnce(
        new ApiError('network', 'offline'),
      )

      await view!.get('[data-testid="refresh"]').trigger('click')
      await flushPromises()

      expect(view!.get('[data-testid="refresh-error"]').text()).toMatch(
        /^Couldn’t refresh\. Showing data from \d{1,2}:\d{2} [ap]m\.$/,
      )
      expect(view!.get('[data-testid="summary-known-outstanding"]').text()).toBe('₹5,750')
      expect(router.currentRoute.value.name).toBe('dashboard')
    })

    it('shows newer figures after a refresh', async () => {
      await mountView()
      fakeDashboard.summary = makeSummary({ knownOutstanding: 21500 })

      await view!.get('[data-testid="refresh"]').trigger('click')
      await flushPromises()

      expect(view!.get('[data-testid="summary-known-outstanding"]').text()).toBe('₹21,500')
    })

    it('shows an error with Try again, never zeros, when the first load fails', async () => {
      vi.mocked(dashboardService.getSummary).mockRejectedValue(new ApiError('unavailable', 'down'))
      await mountView()

      expect(view!.get('[data-testid="dashboard-error"]').text()).toContain(
        'Rent due is unavailable right now.',
      )
      expect(view!.find('[data-testid="summary-known-outstanding"]').exists()).toBe(false)
      expect(view!.text()).not.toContain('₹0')
    })

    it('goes back to rent due from a tenant, refreshing it', async () => {
      await mountView()
      useTenantStore().selectTenant('tenant-001')
      await flushPromises()

      await view!.get('[data-testid="back-to-pending"]').trigger('click')
      await flushPromises()

      expect(view!.find('[data-testid="pending-payments"]').exists()).toBe(true)
      expect(dashboardService.getSummary).toHaveBeenCalledTimes(2)
    })
  })
  describe('overdue bills', () => {
    beforeEach(() => {
      openAt = OVERDUE
    })

    const annex = {
      id: '6f1c2a4e-0000-4000-8000-000000000002',
      name: 'Annex',
      role: 'manager' as const,
    }

    function shownTenants() {
      return view!.findAll('[data-testid="overdue-tenant"]').map((tenant) => ({
        name: tenant.get('[data-testid="overdue-tenant-name"]').text(),
        outstanding: tenant.get('[data-testid="overdue-tenant-outstanding"]').text(),
        months: tenant.findAll('[data-testid="overdue-bill"] th').map((th) => th.text()),
      }))
    }

    async function search(text: string) {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await view!.get('[data-testid="overdue-search"]').setValue(text)
      vi.advanceTimersByTime(300)
      vi.useRealTimers()
      await flushPromises()
    }

    it('opens on every overdue month, grouped by tenant, the oldest first', async () => {
      await mountView()

      expect(dashboardService.getOverdueBills).toHaveBeenCalledWith({
        propertyId: null,
        month: null,
        search: '',
      })
      expect(shownTenants()).toEqual([
        {
          name: 'Mohammed Yusuf',
          outstanding: '₹31,500',
          months: ['August 2026', 'September 2026'],
        },
        { name: 'Shaik Zahid Ali', outstanding: '₹5,750', months: ['September 2026'] },
      ])
      expect(view!.get('[data-testid="overdue-totals"]').text()).toBe(
        '₹37,250 outstanding · 2 tenants · 3 overdue bills',
      )
      const zahid = view!.findAll('[data-testid="overdue-tenant"]')[1]!
      expect(zahid.text()).toContain('Flat 202')
      expect(zahid.text()).toContain('1 overdue bill')
      expect(
        zahid
          .get('[data-testid="overdue-bill"]')
          .findAll('td')
          .map((td) => td.text()),
      ).toEqual(['11 Oct 2026 Overdue 4 days', '₹15,750', '₹10,000', '₹5,750', 'View bill'])
      expect(view!.get('[data-testid="updated-at"]').text()).toBe('Updated just now')
    })

    it('opens a bill, and a tenant’s bills', async () => {
      await mountView()

      await view!
        .get('button[aria-label="View bill: August 2026 · Mohammed Yusuf"]')
        .trigger('click')
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
      expect(router.currentRoute.value.params).toEqual({
        tenantId: 'tenant-002',
        entryId: 'entry-002',
      })
      expect(router.currentRoute.value.query).toEqual({ from: 'dashboard' })

      view!.unmount()
      view = undefined
      await mountView()
      await view!.findAll('[data-testid="overdue-tenant-name"]')[1]!.trigger('click')
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
      expect(router.currentRoute.value.params.tenantId).toBe('tenant-001')
    })

    it('selects another property’s bill’s property before opening it', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
      fakeDashboard.overdueTenants = [
        makeOverdueTenant({ propertyId: annex.id, propertyName: 'Annex' }),
      ]
      await mountView(async () => {
        await useAuthStore().init()
        await useAccessStore().load()
        useAccessStore().selectProperty(testProperty.id)
      })
      expect(view!.get('[data-testid="overdue-tenant"]').text()).toContain('Annex · Flat 202')

      await view!
        .get('button[aria-label="View bill: September 2026 · Shaik Zahid Ali"]')
        .trigger('click')

      expect(useAccessStore().selectedPropertyId).toBe(annex.id)
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
    })

    it('searches and filters, then clears back to the full list', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
      await mountView(async () => {
        await useAuthStore().init()
        await useAccessStore().load()
        useAccessStore().selectProperty(testProperty.id)
      })

      await search('flat 202')
      expect(shownTenants().map((tenant) => tenant.name)).toEqual(['Shaik Zahid Ali'])

      await view!.get('[data-testid="overdue-filter-month"]').setValue('2026-08')
      await flushPromises()
      expect(dashboardService.getOverdueBills).toHaveBeenLastCalledWith({
        propertyId: null,
        month: '2026-08',
        search: 'flat 202',
      })
      expect(view!.find('[data-testid="overdue-tenant"]').exists()).toBe(false)
      expect(view!.get('[data-testid="overdue-empty"]').text()).toContain(
        'No overdue bills match your filters.',
      )

      await view!.get('[data-testid="overdue-filter-property"]').setValue(annex.id)
      await flushPromises()
      expect(dashboardService.getOverdueBills).toHaveBeenLastCalledWith({
        propertyId: annex.id,
        month: '2026-08',
        search: 'flat 202',
      })

      await view!.get('[data-testid="overdue-empty"] button').trigger('click')
      await flushPromises()

      expect(dashboardService.getOverdueBills).toHaveBeenLastCalledWith({
        propertyId: null,
        month: null,
        search: '',
      })
      expect(shownTenants()).toHaveLength(2)
      expect((view!.get('[data-testid="overdue-search"]').element as HTMLInputElement).value).toBe(
        '',
      )
    })

    it('offers no property filter with a single property', async () => {
      await mountView()

      expect(view!.find('[data-testid="overdue-filter-property"]').exists()).toBe(false)
      expect(view!.get('[data-testid="overdue-tenant"]').text()).not.toContain('Test Towers')
    })

    it('says so when nothing is overdue', async () => {
      fakeDashboard.overdueTenants = []
      await mountView()

      expect(view!.get('[data-testid="overdue-empty"]').text()).toBe('No overdue bills.')
      expect(view!.find('[data-testid="overdue-totals"]').exists()).toBe(false)
    })

    it('shows an error with Try again, never “No overdue bills”, when loading fails', async () => {
      vi.mocked(dashboardService.getOverdueBills).mockRejectedValue(
        new ApiError('unavailable', 'down'),
      )
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await mountView()
      vi.useRealTimers()

      expect(view!.get('[data-testid="overdue-error"]').text()).toContain(
        'Overdue bills are unavailable right now.',
      )
      expect(view!.text()).not.toContain('No overdue bills')

      vi.mocked(dashboardService.getOverdueBills)
        .mockReset()
        .mockResolvedValue({
          asOfDate: '2026-10-15',
          generatedAt: '2026-10-15T06:30:00Z',
          tenantCount: 1,
          billCount: 1,
          totalOutstanding: 5750,
          tenants: [makeOverdueTenant()],
        })
      await view!.get('[data-testid="overdue-error"] button').trigger('click')
      await flushPromises()

      expect(shownTenants().map((tenant) => tenant.name)).toEqual(['Shaik Zahid Ali'])
    })

    it('keeps the list, with its time, when a refresh fails; a refresh shows newer bills', async () => {
      await mountView()
      vi.mocked(dashboardService.getOverdueBills).mockRejectedValueOnce(
        new ApiError('network', 'offline'),
      )

      await view!.get('[data-testid="refresh"]').trigger('click')
      await flushPromises()

      expect(view!.get('[data-testid="refresh-error"]').text()).toContain('Couldn’t refresh')
      expect(shownTenants()).toHaveLength(2)

      fakeDashboard.overdueTenants = [
        makeOverdueTenant({ bills: [makeOverdueBill({ outstanding: 1000 })] }),
      ]
      await view!.get('[data-testid="refresh"]').trigger('click')
      await flushPromises()

      expect(view!.find('[data-testid="refresh-error"]').exists()).toBe(false)
      expect(shownTenants()).toEqual([
        { name: 'Shaik Zahid Ali', outstanding: '₹1,000', months: ['September 2026'] },
      ])
    })

    it('switches to rent due and back', async () => {
      await mountView()

      await view!.get('[data-testid="dashboard-tab-rent-due"]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({})
      expect(view!.get('h1').text()).toBe('Rent due')
      expect(dashboardService.getSummary).toHaveBeenCalledTimes(1)

      await view!.get('[data-testid="dashboard-tab-overdue"]').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.query).toEqual({ view: 'overdue' })
      expect(view!.get('h1').text()).toBe('Overdue bills')
      expect(dashboardService.getOverdueBills).toHaveBeenCalledTimes(2)
    })
  })
})
