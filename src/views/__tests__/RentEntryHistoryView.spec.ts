import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { LOAD_ERROR_MESSAGE } from '@/stores/rentEntry'
import { makeEntry, openPage, storeEntries } from '@/test/rentEntries'
import { RENT_ENTRIES_STORAGE_KEY } from '@/utils/rentEntryStorage'

vi.mock('@/services/auth.service', () => ({
  authService: { sendOtp: vi.fn(), verifyOtp: vi.fn(), logout: vi.fn() },
}))

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
  return Object.fromEntries(
    section.findAll('dl > div').map((tile) => [tile.get('dt').text(), tile.get('dd').text()]),
  )
}

function button(label: string) {
  const match = view!.findAll('button').find((b) => b.text() === label)
  if (!match) throw new Error(`No "${label}" button`)
  return match
}

const october = makeEntry({
  id: 'oct',
  billingMonth: '2026-10',
  totalPaid: 10000,
  paidDate: '2026-10-02',
})
const september = makeEntry({
  id: 'sep',
  billingMonth: '2026-09',
  totalPaid: 15750,
  paidDate: '2026-09-10',
})
const august = makeEntry({ id: 'aug', billingMonth: '2026-08' })
const lastYear = makeEntry({ id: 'dec', billingMonth: '2025-12' })
const otherTenant = makeEntry({
  id: 'other',
  tenantId: 'tenant-002',
  billingMonth: '2026-07',
  rentAmount: 18000,
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

describe('RentEntryHistoryView', () => {
  it('shows only this tenant’s entries, newest billing month first, after a refresh', async () => {
    // Saved out of order, mixed with another tenant's entry.
    storeEntries(august, otherTenant, october, lastYear, september)
    await openHistory()

    expect(view!.get('[data-testid="tenant-chip"]').text()).toBe('Shaik Zahid Ali · Flat 202')
    expect(rows().map((row) => row[0])).toEqual([
      'October 2026',
      'September 2026',
      'August 2026',
      'December 2025',
    ])
    expect(rows()[0]).toEqual([
      'October 2026',
      '₹15,750',
      '₹10,000',
      '₹5,750',
      'Partially paid',
      'View',
    ])
    expect(view!.text()).not.toContain('July 2026')
  })

  it('totals every entry when no filter is set', async () => {
    storeEntries(october, september, august)
    await openHistory()

    expect(totals()).toEqual({
      'Total billed': '₹47,250',
      'Total paid': '₹25,750',
      Outstanding: '₹21,500',
    })
  })

  it('filters by status, and the totals cover only the displayed entries', async () => {
    storeEntries(october, september, august, lastYear)
    await openHistory()

    await view!.get('#filter-status').setValue('unpaid')

    expect(rows().map((row) => row[0])).toEqual(['August 2026', 'December 2025'])
    expect(totals()).toEqual({
      'Total billed': '₹31,500',
      'Total paid': '₹0',
      Outstanding: '₹31,500',
    })
  })

  it('filters by the years present in the tenant’s entries', async () => {
    storeEntries(october, lastYear, otherTenant)
    await openHistory()

    expect(view!.findAll('#filter-year option').map((o) => o.text())).toEqual([
      'All years',
      '2026',
      '2025',
    ])

    await view!.get('#filter-year').setValue('2025')

    expect(rows().map((row) => row[0])).toEqual(['December 2025'])
  })

  it('shows a no-match message with Clear filters when filters match nothing', async () => {
    storeEntries(september)
    await openHistory()

    await view!.get('#filter-status').setValue('unpaid')

    expect(view!.text()).toContain('No entries match these filters.')
    expect(view!.find('section[aria-labelledby="entry-totals-heading"]').exists()).toBe(false)

    await view!
      .findAll('button')
      .filter((b) => b.text() === 'Clear filters')[1]!
      .trigger('click')

    expect(rows().map((row) => row[0])).toEqual(['September 2026'])
  })

  it('shows the first-entry empty state when the tenant has no entries', async () => {
    storeEntries(otherTenant)
    await openHistory()

    expect(view!.text()).toContain('No rent entries yet. Add the first entry for this tenant.')
    expect(view!.find('section[aria-labelledby="entry-totals-heading"]').exists()).toBe(false)

    await view!
      .findAll('button')
      .filter((b) => b.text() === 'Add New Entry')[1]!
      .trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-new'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-001')
  })

  it('shows a load error and no zero-balance summary when stored data can’t load, then retries', async () => {
    localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, '{not json')
    await openHistory()

    expect(view!.get('[role="alert"]').text()).toContain(LOAD_ERROR_MESSAGE)
    expect(view!.text()).not.toContain('No rent entries yet')
    expect(view!.text()).not.toContain('₹0')
    expect(view!.find('section[aria-labelledby="entry-totals-heading"]').exists()).toBe(false)

    storeEntries(september)
    await button('Retry').trigger('click')
    await flushPromises()

    expect(view!.text()).not.toContain(LOAD_ERROR_MESSAGE)
    expect(rows().map((row) => row[0])).toEqual(['September 2026'])
  })

  it('shows Tenant not found for an unknown tenant', async () => {
    storeEntries(september)
    await openHistory('tenant-999')

    expect(view!.get('[role="alert"]').text()).toContain('Tenant not found')
    expect(view!.text()).not.toContain('September 2026')
  })

  it('opens an entry’s details', async () => {
    storeEntries(september)
    await openHistory()

    await view!.get('[aria-label="View September 2026"]').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
    expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001', entryId: 'sep' })
  })

  it('goes back to the dashboard', async () => {
    await openHistory()

    await button('Back to Dashboard').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})
