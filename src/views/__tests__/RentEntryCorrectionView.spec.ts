import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { rentEntryService } from '@/services/rentEntry.service'
import { CORRECTION_UNCONFIRMED_MESSAGE } from '@/stores/rentEntry'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { resetTenantService } from '@/test/mocks/tenantService'
import { makeEntry, makePayment, openPage } from '@/test/rentEntries'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
vi.mock('@/services/receipt.service', () => import('@/test/mocks/receiptService'))

const correctEntryApi = vi.mocked(rentEntryService.correctEntry)
const REASON = 'Electricity units were entered as 750 instead of 75.'

// October, with 750 units instead of 75: ₹15,000 + 750 × ₹6 + ₹300 = ₹19,800.
const october = makeEntry({ id: 'oct', billingMonth: '2026-10', electricityUnits: 750 })
const september = makeEntry({ id: 'sep', billingMonth: '2026-09' })

let view: VueWrapper | undefined

async function openCorrection(entryId = 'oct') {
  view = await openPage(`/tenants/tenant-001/entries/${entryId}/correct`)
  return view
}

function button(label: string) {
  const match = view!.findAll('button').find((b) => b.text() === label)
  if (!match) throw new Error(`No "${label}" button`)
  return match
}

async function submitCorrection(units = '75', reason = REASON) {
  await view!.get('#correction-electricityUnits').setValue(units)
  await view!.get('#correction-reason').setValue(reason)
  await view!.get('form').trigger('submit')
  await flushPromises()
}

// Pages load on demand, so navigating takes more than a flush.
async function waitForRoute(name: string) {
  await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(name))
  await flushPromises()
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
  resetRentEntryService()
  fakeEntries.entries = [october, september]
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
})

describe('RentEntryCorrectionView', () => {
  it('shows the original values beside editable replacement values', async () => {
    await openCorrection()

    expect(view!.get('h1').text()).toBe('Correct October 2026 bill')
    expect(view!.get('[data-testid="tenant-chip"]').text()).toBe('Shaik Zahid Ali · Flat 202')
    expect((view!.get('#correction-electricityUnits').element as HTMLInputElement).value).toBe(
      '750',
    )
    expect(view!.get('[data-testid="correction-totals"]').text()).toContain('₹19,800')
  })

  // Given October's bill contains incorrect electricity units, and it has no unreversed
  // payments, when I submit a corrected replacement, then the original bill becomes void, the
  // replacement becomes active, both remain visible in history, and only the replacement
  // contributes to financial totals.
  it('corrects October’s electricity: the original void, the replacement counted', async () => {
    await openCorrection()
    expect(view!.get('[data-testid="replacement-total"]').text()).toBe('₹19,800')

    await view!.get('#correction-electricityUnits').setValue('75')
    expect(view!.get('[data-testid="replacement-total"]').text()).toBe('₹15,750')
    await submitCorrection()

    // The replacement opens, linked to the original.
    await waitForRoute('rent-entry-details')
    const replacementId = router.currentRoute.value.params.entryId as string
    expect(replacementId).not.toBe('oct')
    expect(view!.get('[role="status"]').text()).toContain('Bill corrected.')
    expect(view!.find('[data-testid="void-notice"]').exists()).toBe(false)
    const link = view!.get('[data-testid="correction-links"] a')
    expect(link.text()).toBe('Replaces void bill · October 2026')

    await link.trigger('click')
    await flushPromises()
    expect(view!.get('[data-testid="void-notice"]').text()).toContain(REASON)

    // The history counts the replacement only; void bills show when asked for, uncounted.
    await router.push('/tenants/tenant-001/entries')
    await waitForRoute('rent-entry-history')
    const months = () =>
      view!
        .findAll('[data-testid="history-row"]')
        .map((row) => [row.get('th').text(), row.findAll('td')[3]!.text()])
    expect(months()).toEqual([
      ['October 2026', 'Unpaid'],
      ['September 2026', 'Unpaid'],
    ])
    const totals = () => view!.get('[aria-labelledby="entry-totals-heading"] dl').text()
    expect(totals()).toContain('₹31,500')

    await view!.get('#filter-show-void').setValue(true)
    await flushPromises()
    expect(months()).toEqual([
      ['October 2026', 'Unpaid'],
      ['October 2026', 'Void'],
      ['September 2026', 'Unpaid'],
    ])
    expect(totals()).toContain('₹31,500')
    expect(view!.get('[data-testid="void-not-counted"]').text()).toBe(
      "The void bill on this page isn't counted.",
    )
  })

  it('lists the payments to reverse first, and corrects nothing', async () => {
    addFakePayment(makePayment({ id: 'p-1', entryId: 'oct', amount: 5000 }))
    await openCorrection()

    expect(view!.get('[data-testid="payments-to-reverse"]').text()).toContain('₹5,000')
    expect(button('Correct bill').attributes('disabled')).toBeDefined()
    expect(correctEntryApi).not.toHaveBeenCalled()
  })

  it('keeps the changes, and the key, after a lost response; the retry is the same correction', async () => {
    // Lost before the backend got it: nothing was corrected.
    correctEntryApi.mockRejectedValueOnce(new ApiError('network', 'Network Error'))
    await openCorrection()

    await submitCorrection()

    expect(view!.text()).toContain(CORRECTION_UNCONFIRMED_MESSAGE)
    expect(router.currentRoute.value.name).toBe('rent-entry-correct')
    expect((view!.get('#correction-reason').element as HTMLTextAreaElement).value).toBe(REASON)

    await view!.get('form').trigger('submit')
    await waitForRoute('rent-entry-details')

    const [first, second] = correctEntryApi.mock.calls
    expect(second![4]).toBe(first![4])
    expect(fakeEntries.entries.filter((e) => e.billingMonth === '2026-10')).toHaveLength(2)
  })

  it('opens the replacement made by an attempt whose response was lost', async () => {
    const fakeCorrect = correctEntryApi.getMockImplementation()!
    correctEntryApi.mockImplementationOnce(async (...args) => {
      await fakeCorrect(...args)
      throw new ApiError('unavailable', 'Bad gateway')
    })
    await openCorrection()

    await submitCorrection()

    // The bill is reloaded: corrected after all.
    expect(view!.get('[role="alert"]').text()).toContain('This bill has already been corrected.')
    await button('Open the replacement').trigger('click')
    await waitForRoute('rent-entry-details')
    expect(router.currentRoute.value.params.entryId).not.toBe('oct')
    expect(view!.get('[data-testid="correction-links"] a').text()).toBe(
      'Replaces void bill · October 2026',
    )
  })

  it('stays while a correction is in flight', async () => {
    let finish!: () => void
    const fakeCorrect = correctEntryApi.getMockImplementation()!
    correctEntryApi.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (finish = resolve))
      return fakeCorrect(...args)
    })
    await openCorrection()
    await submitCorrection()

    expect(button('Back to the bill').attributes('disabled')).toBeDefined()
    await router.push('/tenants/tenant-001/entries')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('rent-entry-correct')

    finish()
    await waitForRoute('rent-entry-details')
  })

  it('cancelling goes back to the bill, unchanged', async () => {
    await openCorrection()

    await button('Cancel').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001', entryId: 'oct' })
    expect(fakeEntries.entries.find((e) => e.id === 'oct')!.billStatus).toBe('active')
  })

  it('says a void bill can’t be corrected', async () => {
    fakeEntries.entries = [makeEntry({ id: 'oct', billingMonth: '2026-10', billStatus: 'void' })]

    await openCorrection()

    expect(view!.get('[role="alert"]').text()).toBe("This bill is void, so it can't be corrected.")
    expect(view!.find('form').exists()).toBe(false)
  })

  it('says only owners can correct bills, for a manager', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(
      identityWith([{ ...testProperty, role: 'manager' }]),
    )

    await openCorrection()

    expect(view!.get('[role="alert"]').text()).toBe("Only the property's owners can correct bills.")
    expect(view!.find('form').exists()).toBe(false)
  })
})
