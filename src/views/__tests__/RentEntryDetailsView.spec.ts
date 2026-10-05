import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { ApiError } from '@/services/apiError'
import { rentEntryService } from '@/services/rentEntry.service'
import { tenantService } from '@/services/tenant.service'
import { ENTRIES_LOAD_ERROR_MESSAGE } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { makeEntry, openPage } from '@/test/rentEntries'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import { fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { resetTenantService, testTenants } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))

const getEntry = vi.mocked(rentEntryService.getEntry)

let view: VueWrapper | undefined

async function openDetails(tenantId: string, entryId: string, query = '') {
  view = await openPage(`/tenants/${tenantId}/entries/${entryId}${query}`)
  return view
}

function section(testId: string) {
  return Object.fromEntries(
    view!
      .get(`[data-testid="${testId}"]`)
      .findAll(':scope > div')
      .map((row) => [row.get('dt').text(), row.get('dd').text()]),
  )
}

function button(label: string) {
  const match = view!.findAll('button').find((b) => b.text() === label)
  if (!match) throw new Error(`No "${label}" button`)
  return match
}

// Billed at older rates than the tenant's current ₹15,000 rent and ₹6 / unit.
const entry = makeEntry({
  id: 'sep',
  billingMonth: '2026-09',
  rentAmount: 14000,
  electricityUnits: 75,
  electricityRate: 5.5,
  waterAmount: 300,
  notes: '<b>Paid</b> in cash',
  createdAt: new Date(2026, 9, 3, 11, 30).toISOString(),
})

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
  resetRentEntryService()
  fakeEntries.entries = [entry]
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
})

describe('RentEntryDetailsView', () => {
  it('loads the bill from the API when opened by URL, as after a refresh', async () => {
    await openDetails('tenant-001', 'sep')

    expect(getEntry).toHaveBeenCalledWith(expect.any(String), 'tenant-001', 'sep')
    expect(view!.get('h1').text()).toBe('September 2026')
  })

  it('shows the entry’s own historical charges, not the tenant’s current rates', async () => {
    expect(testTenants[0]).toMatchObject({ rentAmount: 15000, electricityRate: 6 })
    await openDetails('tenant-001', 'sep')

    expect(view!.get('[data-testid="tenant-chip"]').text()).toBe('Shaik Zahid Ali · Flat 202')
    expect(section('charges')).toEqual({
      Rent: '₹14,000',
      'Electricity units': '75',
      'Electricity rate': '₹5.50 / unit',
      'Electricity amount': '₹412.50',
      Water: '₹300',
    })
  })

  it('shows the backend’s figures and status', async () => {
    fakeEntries.entries = [
      makeEntry({ ...entry, electricityAmount: 413, totalDue: 14713, outstanding: 14713 }),
    ]
    await openDetails('tenant-001', 'sep')

    expect(section('charges')['Electricity amount']).toBe('₹413')
    expect(section('payment')).toEqual({
      'Total due': '₹14,713',
      'Total paid': '₹0',
      Outstanding: '₹14,713',
    })
    expect(view!.text()).toContain('Unpaid')
  })

  it('says payments can’t be recorded yet, with no Record Payment button', async () => {
    await openDetails('tenant-001', 'sep')

    expect(view!.get('[data-testid="payments-unavailable"]').text()).toContain(
      "Payments can't be recorded yet.",
    )
    expect(view!.findAll('button').some((b) => b.text().includes('Record Payment'))).toBe(false)
  })

  it('shows Fully paid for a paid bill', async () => {
    fakeEntries.entries = [
      makeEntry({ ...entry, totalPaid: 14712.5, outstanding: 0, status: 'paid' }),
    ]
    await openDetails('tenant-001', 'sep')

    expect(view!.get('[data-testid="fully-paid"]').text()).toBe('Fully paid')
    expect(view!.find('[data-testid="payments-unavailable"]').exists()).toBe(false)
  })

  it('renders notes as text, and shows when the entry was created', async () => {
    await openDetails('tenant-001', 'sep')

    expect(section('other')).toEqual({
      Notes: '<b>Paid</b> in cash',
      Created: '3 Oct 2026, 11:30 am',
    })
    expect(view!.find('[data-testid="other"] b').exists()).toBe(false)
  })

  it('says when no notes are recorded', async () => {
    fakeEntries.entries = [makeEntry({ id: 'plain' })]
    await openDetails('tenant-001', 'plain')

    expect(section('other').Notes).toBe('No notes')
  })

  it('shows Entry not found for another tenant’s entry under this tenant’s URL', async () => {
    await openDetails('tenant-002', 'sep')

    expect(view!.get('[role="alert"]').text()).toContain('Entry not found')
    expect(view!.text()).not.toContain('₹14,000')

    await button('Back to Previous Entries').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-002')
  })

  it('shows Entry not found for an unknown entry id', async () => {
    await openDetails('tenant-001', 'nope')

    expect(view!.get('[role="alert"]').text()).toContain('Entry not found')
  })

  it('shows Tenant not found for an unknown tenant', async () => {
    await openDetails('tenant-999', 'sep')

    expect(view!.get('[role="alert"]').text()).toContain('Tenant not found')

    await button('Back to Dashboard').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('shows a load error rather than Entry not found, then retries', async () => {
    view = await openPage('/tenants/tenant-001/entries/sep', () => {
      getEntry.mockRejectedValueOnce(new ApiError('unknown'))
    })

    expect(view.get('[role="alert"]').text()).toContain(ENTRIES_LOAD_ERROR_MESSAGE)
    expect(view.text()).not.toContain('Entry not found')

    await button('Retry').trigger('click')
    await flushPromises()

    expect(view.get('h1').text()).toBe('September 2026')
  })

  it('goes back to the tenant’s history by route, not browser history', async () => {
    await openDetails('tenant-001', 'sep')
    const back = vi.spyOn(router, 'back')

    await button('Back to Previous Entries').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-001')
    expect(back).not.toHaveBeenCalled()
  })

  it('goes back to the dashboard, with the tenant selected, when opened from there', async () => {
    await openDetails('tenant-001', 'sep', '?from=dashboard')

    expect(view!.text()).not.toContain('Back to Previous Entries')
    await button('Back to Dashboard').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('dashboard'))
    expect(useTenantStore().selectedTenantId).toBe('tenant-001')
  })

  it('ignores an unknown entry point and goes back to the history', async () => {
    await openDetails('tenant-001', 'sep', '?from=elsewhere')

    await button('Back to Previous Entries').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
  })
})

describe('RentEntryDetailsView when the URL changes in place', () => {
  it('loads and shows the new entry without a reload', async () => {
    fakeEntries.entries = [entry, makeEntry({ id: 'aug', billingMonth: '2026-08' })]
    await openDetails('tenant-001', 'sep')

    await router.push('/tenants/tenant-001/entries/aug')
    await flushPromises()

    expect(view!.get('h1').text()).toBe('August 2026')
  })
})

describe('RentEntryDetailsView when tenants fail to load', () => {
  it('shows the error with Retry instead of Loading or Tenant not found, then recovers', async () => {
    view = await openPage('/tenants/tenant-001/entries/sep', () => {
      // The tenancy request fails once; Retry succeeds.
      vi.mocked(tenantService.getTenant).mockRejectedValueOnce(new Error('boom'))
    })

    expect(view.get('[role="alert"]').text()).toContain('Unable to load tenants. Please try again.')
    expect(view.text()).not.toContain('Loading')
    expect(view.text()).not.toContain('Tenant not found')

    await button('Retry').trigger('click')
    await flushPromises()

    expect(view.get('h1').text()).toBe('September 2026')
  })
})
