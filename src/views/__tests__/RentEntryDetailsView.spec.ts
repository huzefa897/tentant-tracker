import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockTenants } from '@/data/tenants.mock'
import router from '@/router'
import { LOAD_ERROR_MESSAGE } from '@/stores/rentEntry'
import { makeEntry, openPage, storeEntries } from '@/test/rentEntries'
import { RENT_ENTRIES_STORAGE_KEY } from '@/utils/rentEntryStorage'

vi.mock('@/services/auth.service', () => ({
  authService: { sendOtp: vi.fn(), verifyOtp: vi.fn(), logout: vi.fn() },
}))

let view: VueWrapper | undefined

async function openDetails(tenantId: string, entryId: string) {
  view = await openPage(`/tenants/${tenantId}/entries/${entryId}`)
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
  totalPaid: 10000,
  paidDate: '2026-10-01',
  notes: '<b>Paid</b> in cash',
  createdAt: new Date(2026, 9, 3, 11, 30).toISOString(),
})

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
})

describe('RentEntryDetailsView', () => {
  it('shows the entry’s own historical charges, not the tenant’s current rates', async () => {
    expect(mockTenants[0]).toMatchObject({ rentAmount: 15000, electricityRate: 6 })
    storeEntries(entry)
    await openDetails('tenant-001', 'sep')

    expect(view!.get('h1').text()).toBe('September 2026')
    expect(view!.get('[data-testid="tenant-chip"]').text()).toBe('Shaik Zahid Ali · Flat 202')
    expect(section('charges')).toEqual({
      Rent: '₹14,000',
      'Electricity units': '75',
      'Electricity rate': '₹5.50 / unit',
      'Electricity amount': '₹412.50',
      Water: '₹300',
    })
  })

  it('shows the derived payment figures and status', async () => {
    storeEntries(entry)
    await openDetails('tenant-001', 'sep')

    expect(section('payment')).toEqual({
      'Total due': '₹14,712.50',
      'Total paid': '₹10,000',
      Outstanding: '₹4,712.50',
      'Paid date': '1 Oct 2026',
    })
    expect(view!.text()).toContain('Partially paid')
  })

  it('renders notes as text, and shows when the entry was created', async () => {
    storeEntries(entry)
    await openDetails('tenant-001', 'sep')

    expect(section('other')).toEqual({
      Notes: '<b>Paid</b> in cash',
      Created: '3 Oct 2026, 11:30 am',
    })
    expect(view!.find('[data-testid="other"] b').exists()).toBe(false)
  })

  it('shows placeholders for a missing paid date and notes', async () => {
    storeEntries(makeEntry({ id: 'unpaid' }))
    await openDetails('tenant-001', 'unpaid')

    expect(section('payment')['Paid date']).toBe('—')
    expect(section('other').Notes).toBe('No notes')
    expect(view!.text()).toContain('Unpaid')
  })

  it('shows Entry not found for another tenant’s entry under this tenant’s URL', async () => {
    storeEntries(entry)
    await openDetails('tenant-002', 'sep')

    expect(view!.get('[role="alert"]').text()).toContain('Entry not found')
    expect(view!.text()).not.toContain('₹14,000')

    await button('Back to Previous Entries').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-002')
  })

  it('shows Entry not found for an unknown entry id', async () => {
    storeEntries(entry)
    await openDetails('tenant-001', 'nope')

    expect(view!.get('[role="alert"]').text()).toContain('Entry not found')
  })

  it('shows Tenant not found for an unknown tenant', async () => {
    storeEntries(entry)
    await openDetails('tenant-999', 'sep')

    expect(view!.get('[role="alert"]').text()).toContain('Tenant not found')

    await button('Back to Dashboard').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('shows a load error rather than Entry not found, then retries', async () => {
    localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, '{not json')
    await openDetails('tenant-001', 'sep')

    expect(view!.get('[role="alert"]').text()).toContain(LOAD_ERROR_MESSAGE)
    expect(view!.text()).not.toContain('Entry not found')

    storeEntries(entry)
    await button('Retry').trigger('click')
    await flushPromises()

    expect(view!.get('h1').text()).toBe('September 2026')
  })

  it('goes back to the tenant’s history by route, not browser history', async () => {
    storeEntries(entry)
    await openDetails('tenant-001', 'sep')
    const back = vi.spyOn(router, 'back')

    await button('Back to Previous Entries').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-001')
    expect(back).not.toHaveBeenCalled()
  })
})
