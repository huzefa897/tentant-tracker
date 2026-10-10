import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { ApiError } from '@/services/apiError'
import { receiptService } from '@/services/receipt.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { tenantService } from '@/services/tenant.service'
import { ENTRIES_LOAD_ERROR_MESSAGE } from '@/stores/rentEntry'
import { makeEntry, makePayment, openPage } from '@/test/rentEntries'
import { fakeReceipts } from '@/test/mocks/receiptService'
import { downloadReceiptPdf } from '@/utils/receiptDownload'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
vi.mock('@/services/receipt.service', () => import('@/test/mocks/receiptService'))
vi.mock('@/utils/receiptDownload', () => ({ downloadReceiptPdf: vi.fn() }))

const getEntries = vi.mocked(rentEntryService.getEntries)

let view: VueWrapper | undefined

async function openHistory(tenantId = 'tenant-001') {
  view = await openPage(`/tenants/${tenantId}/entries`)
  return view
}

function rows() {
  return view!
    .findAll('[data-testid="history-row"]')
    .map((row) => row.findAll('th, td').map((cell) => cell.text()))
}

function totals() {
  const section = view!.get('section[aria-labelledby="entry-totals-heading"]')
  const tiles: Record<string, string> = Object.fromEntries(
    section.findAll('dl > div').map((tile) => [tile.get('dt').text(), tile.get('dd').text()]),
  )
  return { ...tiles, heading: section.get('h2').text() } as Record<string, string>
}

function button(label: string) {
  const match = view!.findAll('button').find((b) => b.text().trim() === label)
  if (!match) throw new Error(`No "${label}" button`)
  return match
}

const october = makeEntry({ id: 'oct', billingMonth: '2026-10' })
const september = makeEntry({ id: 'sep', billingMonth: '2026-09', waterAmount: 0 })
const lastYear = makeEntry({ id: 'dec', billingMonth: '2025-12' })
const otherTenant = makeEntry({
  id: 'other',
  tenantId: 'tenant-002',
  billingMonth: '2026-07',
  rentAmount: 18000,
})

// A year and a bit of monthly bills, to fill more than one page of 12.
function months(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(2026, 9 - i, 1)
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    return makeEntry({ id: `m${i}`, billingMonth: month })
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 5, 12, 0))
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
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('RentEntryHistoryView', () => {
  it('loads this tenant’s bills from the API, newest billing month first', async () => {
    fakeEntries.entries = [september, otherTenant, october, lastYear]
    await openHistory()

    expect(getEntries).toHaveBeenCalledWith(expect.any(String), 'tenant-001', {
      billStatus: 'active',
      year: undefined,
      page: 1,
    })
    expect(view!.get('[data-testid="tenant-chip"]').text()).toBe('Shaik Zahid Ali · Flat 202')
    expect(rows()).toEqual([
      ['October 2026', '₹15,750', '₹0', '₹15,750', 'Unpaid', 'View Summary'],
      ['September 2026', '₹15,450', '₹0', '₹15,450', 'Unpaid', 'View Summary'],
      ['December 2025', '₹15,750', '₹0', '₹15,750', 'Unpaid', 'View Summary'],
    ])
    expect(view!.text()).not.toContain('July 2026')
  })

  it('shows skeleton rows while the first page loads', async () => {
    getEntries.mockReturnValueOnce(new Promise(() => {}))
    await openHistory()

    const loading = view!.get('[data-testid="history-loading"]')
    expect(loading.text()).toBe('Loading entries…')
    expect(view!.text()).not.toContain('No rent entries yet.')
  })

  it('keeps the filters on screen while another filter loads', async () => {
    fakeEntries.entries = [october, september, lastYear]
    await openHistory()
    getEntries.mockReturnValueOnce(new Promise(() => {}))

    await view!.get('#filter-year').setValue('2025')
    await flushPromises()

    expect(view!.get<HTMLSelectElement>('#filter-year').element.value).toBe('2025')
    expect(view!.get('[data-testid="history-loading"]').text()).toBe('Loading entries…')
    expect(view!.find('[data-testid="history-row"]').exists()).toBe(false)
  })

  it('labels the totals as this page’s', async () => {
    fakeEntries.entries = [october, september]
    await openHistory()

    expect(totals()).toEqual({
      heading: 'Totals for this page',
      'Total billed': '₹31,200',
      'Total paid': '₹0',
      Outstanding: '₹31,200',
    })
  })

  it('pages through the bills, totalling only the page shown', async () => {
    fakeEntries.entries = months(14)
    await openHistory()

    expect(rows()).toHaveLength(12)
    expect(view!.get('[data-testid="page-position"]').text()).toBe('Page 1 of 2 · 14 entries')
    expect(totals()['Total billed']).toBe('₹1,89,000')
    expect(button('Newer').attributes('disabled')).toBeDefined()

    await button('Older').trigger('click')
    await flushPromises()

    expect(rows().map((row) => row[0])).toEqual(['October 2025', 'September 2025'])
    expect(view!.get('[data-testid="page-position"]').text()).toBe('Page 2 of 2 · 14 entries')
    expect(totals()['Total billed']).toBe('₹31,500')
    expect(button('Older').attributes('disabled')).toBeDefined()
  })

  it('offers no paging when everything fits on one page', async () => {
    fakeEntries.entries = [october]
    await openHistory()

    expect(view!.find('nav[aria-label="Pages"]').exists()).toBe(false)
  })

  it('offers the years of the tenancy and filters on the server', async () => {
    fakeEntries.entries = [october, september, lastYear]
    await openHistory()

    // The test tenancy started in April 2025 and continues to today (2026).
    expect(view!.findAll('#filter-year option').map((o) => o.text())).toEqual([
      'All years',
      '2026',
      '2025',
    ])

    await view!.get('#filter-year').setValue('2025')
    await flushPromises()

    expect(getEntries).toHaveBeenLastCalledWith(expect.any(String), 'tenant-001', {
      billStatus: 'active',
      year: '2025',
      paymentStatus: undefined,
      page: 1,
    })
    expect(rows().map((row) => row[0])).toEqual(['December 2025'])
  })

  it('filters by payment status on the server, with the backend’s balances', async () => {
    fakeEntries.entries = [
      october,
      makeEntry({ ...september, totalPaid: 5000, outstanding: 10450, status: 'partially_paid' }),
      makeEntry({ ...lastYear, totalPaid: 15750, outstanding: 0, status: 'paid' }),
    ]
    await openHistory()

    expect(view!.findAll('#filter-status option').map((o) => o.text())).toEqual([
      'All',
      'Unpaid',
      'Partially paid',
      'Paid',
    ])

    await view!.get('#filter-status').setValue('partially_paid')
    await flushPromises()

    expect(getEntries).toHaveBeenLastCalledWith(expect.any(String), 'tenant-001', {
      billStatus: 'active',
      year: undefined,
      paymentStatus: 'partially_paid',
      page: 1,
    })
    expect(rows().map((row) => [row[0], row[2], row[3], row[4]])).toEqual([
      ['September 2026', '₹5,000', '₹10,450', 'Partially paid'],
    ])
  })

  it('names both filters when nothing matches', async () => {
    fakeEntries.entries = [october]
    await openHistory()

    await view!.get('#filter-year').setValue('2026')
    await view!.get('#filter-status').setValue('paid')
    await flushPromises()

    expect(view!.text()).toContain('No paid entries in 2026.')
  })

  it('shows a no-match message with Clear filters when a year has no bills', async () => {
    fakeEntries.entries = [october]
    await openHistory()

    await view!.get('#filter-year').setValue('2025')
    await flushPromises()

    expect(view!.text()).toContain('No entries in 2025.')
    expect(view!.find('[data-testid="history-row"]').exists()).toBe(false)

    await view!
      .findAll('button')
      .filter((b) => b.text().trim() === 'Clear filters')
      .slice(-1)[0]!
      .trigger('click')
    await flushPromises()

    expect(rows().map((row) => row[0])).toEqual(['October 2026'])
  })

  it('shows the first-entry empty state when the tenant has no bills', async () => {
    await openHistory()

    expect(view!.text()).toContain('No rent entries yet.')
    expect(view!.find('section[aria-labelledby="entry-totals-heading"]').exists()).toBe(false)

    await button('Add New Entry').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-new'))
  })

  it('offers to show the void bills when every bill is void', async () => {
    fakeEntries.entries = [{ ...october, billStatus: 'void' }]
    await openHistory()

    expect(view!.text()).not.toContain('No rent entries yet.')
    expect(view!.get('[data-testid="all-bills-void"]').text()).toContain(
      'No active bills. The only bill is void, so it’s hidden.',
    )
    expect(view!.find('#filter-show-void').exists()).toBe(true)

    await button('Show void bills').trigger('click')
    await flushPromises()

    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toEqual(expect.arrayContaining(['October 2026', 'Void']))
    expect(view!.get('#filter-show-void').attributes('aria-checked')).toBe('true')
  })

  it('shows a load error, not an empty history or zero totals, then retries', async () => {
    fakeEntries.entries = [october]
    getEntries.mockRejectedValueOnce(new ApiError('unknown'))
    await openHistory()

    expect(view!.get('[role="alert"]').text()).toContain(ENTRIES_LOAD_ERROR_MESSAGE)
    expect(view!.text()).not.toContain('No rent entries yet.')
    expect(view!.find('section[aria-labelledby="entry-totals-heading"]').exists()).toBe(false)

    await button('Retry').trigger('click')
    await flushPromises()

    expect(rows().map((row) => row[0])).toEqual(['October 2026'])
  })

  it('shows Tenant not found for an unknown tenant', async () => {
    await openHistory('nope')

    expect(view!.text()).toContain('Tenant not found')
    expect(view!.find('[data-testid="history-row"]').exists()).toBe(false)
  })

  it('downloads a paid bill’s latest receipt from its row', async () => {
    vi.mocked(downloadReceiptPdf).mockReset().mockResolvedValue()
    fakeEntries.entries = [october, september]
    addFakePayment(makePayment({ id: 'p-sep', entryId: 'sep', amount: 5000 }))
    await openHistory()

    expect(view!.find('[aria-label="Download the latest receipt for October 2026"]').exists()).toBe(
      false,
    )
    await view!
      .get('[aria-label="Download the latest receipt for September 2026"]')
      .trigger('click')
    await flushPromises()

    expect(receiptService.issueReceipt).toHaveBeenCalledWith(
      expect.any(String),
      'tenant-001',
      'sep',
      'p-sep',
    )
    expect(downloadReceiptPdf).toHaveBeenCalledWith(fakeReceipts.get('p-sep'))
  })

  it('says when a receipt can’t be made, keeping the history', async () => {
    vi.mocked(downloadReceiptPdf).mockReset().mockResolvedValue()
    vi.mocked(receiptService.issueReceipt).mockRejectedValueOnce(new ApiError('forbidden'))
    fakeEntries.entries = [september]
    addFakePayment(makePayment({ id: 'p-sep', entryId: 'sep', amount: 5000 }))
    await openHistory()

    await view!
      .get('[aria-label="Download the latest receipt for September 2026"]')
      .trigger('click')
    await flushPromises()

    expect(view!.get('[role="alert"]').text()).toBe(
      "You don't have permission to issue receipts for this property.",
    )
    expect(rows().map((row) => row[0])).toEqual(['September 2026'])
  })

  it('drops a pending receipt download when the filter changes', async () => {
    vi.mocked(downloadReceiptPdf).mockReset().mockResolvedValue()
    let fail!: (error: unknown) => void
    vi.mocked(receiptService.issueReceipt).mockReturnValueOnce(
      new Promise((_, reject) => (fail = reject)),
    )
    fakeEntries.entries = [september, lastYear]
    addFakePayment(makePayment({ id: 'p-sep', entryId: 'sep', amount: 5000 }))
    addFakePayment(makePayment({ id: 'p-dec', entryId: 'dec', amount: 5000 }))
    await openHistory()

    await view!
      .get('[aria-label="Download the latest receipt for September 2026"]')
      .trigger('click')
    await flushPromises()
    await view!.get('#filter-year').setValue('2025')
    await flushPromises()

    const december = view!.get('[aria-label="Download the latest receipt for December 2025"]')
    expect(december.attributes('disabled')).toBeUndefined()
    fail(new ApiError('forbidden'))
    await flushPromises()

    expect(rows().map((row) => row[0])).toEqual(['December 2025'])
    expect(view!.find('[role="alert"]').exists()).toBe(false)
  })

  it('drops a pending receipt download when the page changes', async () => {
    vi.mocked(downloadReceiptPdf).mockReset().mockResolvedValue()
    let fail!: (error: unknown) => void
    vi.mocked(receiptService.issueReceipt).mockReturnValueOnce(
      new Promise((_, reject) => (fail = reject)),
    )
    fakeEntries.entries = months(14)
    addFakePayment(makePayment({ id: 'p-oct', entryId: 'm0', amount: 5000 }))
    addFakePayment(makePayment({ id: 'p-old', entryId: 'm12', amount: 5000 }))
    await openHistory()

    await view!.get('[aria-label="Download the latest receipt for October 2026"]').trigger('click')
    await flushPromises()
    await button('Older').trigger('click')
    await flushPromises()

    const older = view!.get('[aria-label="Download the latest receipt for October 2025"]')
    expect(older.attributes('disabled')).toBeUndefined()
    fail(new ApiError('forbidden'))
    await flushPromises()

    expect(view!.find('[role="alert"]').exists()).toBe(false)
  })

  it('opens an entry’s summary', async () => {
    fakeEntries.entries = [october]
    await openHistory()

    await view!.get('[aria-label="View summary for October 2026"]').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))

    expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001', entryId: 'oct' })
  })

  it('goes back to the dashboard', async () => {
    await openHistory()

    await button('Back to Dashboard').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})

describe('RentEntryHistoryView when the URL changes in place', () => {
  it('shows the new tenant’s bills with the filter and page reset', async () => {
    fakeEntries.entries = [lastYear, september, otherTenant]
    await openHistory()
    await view!.get('#filter-year').setValue('2025')
    await flushPromises()

    await router.push('/tenants/tenant-002/entries')
    await flushPromises()

    expect(view!.get('[data-testid="tenant-chip"]').text()).toBe('Mohammed Yusuf · Flat 301')
    expect((view!.get('#filter-year').element as HTMLSelectElement).value).toBe('all')
    expect(rows().map((row) => row[0])).toEqual(['July 2026'])
  })
})

describe('RentEntryHistoryView when tenants fail to load', () => {
  it('shows the error with Retry instead of Tenant not found, then recovers', async () => {
    fakeEntries.entries = [september]
    view = await openPage('/tenants/tenant-001/entries', () => {
      // The tenancy request fails once; Retry succeeds.
      vi.mocked(tenantService.getTenant).mockRejectedValueOnce(new Error('boom'))
    })

    expect(view.get('[role="alert"]').text()).toContain('Unable to load tenants. Please try again.')
    expect(view.text()).not.toContain('Tenant not found')

    await button('Retry').trigger('click')
    await flushPromises()

    expect(view.get('[data-testid="tenant-chip"]').text()).toBe('Shaik Zahid Ali · Flat 202')
    expect(rows().map((row) => row[0])).toEqual(['September 2026'])
  })
})
