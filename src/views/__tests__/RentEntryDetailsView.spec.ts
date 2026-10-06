import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { ApiError } from '@/services/apiError'
import { paymentService } from '@/services/payment.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { tenantService } from '@/services/tenant.service'
import {
  ENTRIES_LOAD_ERROR_MESSAGE,
  PAYMENT_SAVE_ERROR_MESSAGE,
  PAYMENT_UNCONFIRMED_MESSAGE,
} from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { makeEntry, makePayment, openPage } from '@/test/rentEntries'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { resetTenantService, testTenants } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))

const getEntry = vi.mocked(rentEntryService.getEntry)
const recordPaymentApi = vi.mocked(paymentService.recordPayment)
const getPayments = vi.mocked(paymentService.getPayments)

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

  it('shows Fully paid for a paid bill', async () => {
    fakeEntries.entries = [
      makeEntry({ ...entry, totalPaid: 14712.5, outstanding: 0, status: 'paid' }),
    ]
    await openDetails('tenant-001', 'sep')

    expect(view!.get('[data-testid="fully-paid"]').text()).toBe('Fully paid')
    expect(view!.findAll('button').some((b) => b.text() === 'Record Payment')).toBe(false)
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

  describe('payments', () => {
    // September: ₹14,712.50 due (₹14,000 + 75 × ₹5.50 + ₹300), ₹10,000 paid, ₹4,712.50 left.
    beforeEach(() => {
      addFakePayment(
        makePayment({ id: 'p-1', entryId: 'sep', amount: 10000, notes: 'Initial payment' }),
      )
    })

    const body = new DOMWrapper(document.body)

    function dialog() {
      return body.get('[role="dialog"]')
    }

    function paymentRows() {
      return view!
        .findAll('[data-testid="payment-row"]')
        .map((row) => row.findAll('td').map((cell) => cell.text()))
    }

    async function openDialog() {
      await button('Record Payment').trigger('click')
      await flushPromises()
    }

    async function submitPayment(amount: string, notes = '') {
      await dialog().get('#payment-amount').setValue(amount)
      await dialog().get('#payment-notes').setValue(notes)
      await dialog().get('form').trigger('submit')
      await flushPromises()
    }

    async function recordPayment(amount: string, notes = '') {
      await openDialog()
      await submitPayment(amount, notes)
    }

    it('lists the bill’s payments from the API, with no receipt buttons yet', async () => {
      await openDetails('tenant-001', 'sep')

      expect(getPayments).toHaveBeenCalledWith(expect.any(String), 'tenant-001', 'sep')
      expect(paymentRows()).toEqual([['3 Oct 2026', '₹10,000', 'Initial payment']])
      expect(view!.find('[data-testid="download-receipt"]').exists()).toBe(false)
    })

    it('shows a failed payment load as an error with Retry, never as no payments', async () => {
      getPayments.mockRejectedValueOnce(new ApiError('network'))
      await openDetails('tenant-001', 'sep')

      expect(view!.text()).not.toContain('No payments recorded')
      expect(view!.text()).toContain("Couldn't reach the server.")

      await button('Retry').trigger('click')
      await flushPromises()

      expect(paymentRows()).toHaveLength(1)
    })

    it('shows the bill and its outstanding amount in the dialog', async () => {
      await openDetails('tenant-001', 'sep')
      await openDialog()

      expect(dialog().get('[data-testid="payment-bill"]').text()).toContain('September 2026')
      expect(dialog().get('[data-testid="payment-bill"]').text()).toContain('₹4,712.50')
    })

    it('records a payment through the API and shows the backend’s new balance', async () => {
      await openDetails('tenant-001', 'sep')

      await recordPayment('3000', 'Bank transfer')

      expect(recordPaymentApi).toHaveBeenCalledWith(
        expect.any(String),
        'tenant-001',
        { entryId: 'sep', amount: 3000, paidDate: expect.any(String), notes: 'Bank transfer' },
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      )
      expect(body.find('[role="dialog"]').exists()).toBe(false)
      expect(view!.get('[role="status"]').text()).toBe('Payment of ₹3,000 recorded.')
      expect(section('payment')).toEqual({
        'Total due': '₹14,712.50',
        'Total paid': '₹13,000',
        Outstanding: '₹1,712.50',
      })
      expect(paymentRows().map((row) => row[1])).toEqual(['₹3,000', '₹10,000'])
    })

    it('settles the bill with the outstanding amount', async () => {
      await openDetails('tenant-001', 'sep')

      await recordPayment('4712.50')

      expect(view!.get('[data-testid="fully-paid"]').text()).toBe('Fully paid')
      expect(view!.text()).toContain('Paid')
    })

    it('uses a new key for each new payment', async () => {
      await openDetails('tenant-001', 'sep')

      await recordPayment('1000')
      await recordPayment('1000')

      const keys = recordPaymentApi.mock.calls.map((call) => call[3])
      expect(keys).toHaveLength(2)
      expect(keys[0]).not.toBe(keys[1])
      expect(fakeEntries.payments).toHaveLength(3)
    })

    it('keeps the dialog and values, without confirming, when saving fails', async () => {
      recordPaymentApi.mockRejectedValueOnce(new ApiError('forbidden'))
      await openDetails('tenant-001', 'sep')

      await recordPayment('3000', 'Cash')

      expect(dialog().get('[role="alert"]').text()).toBe(
        "You don't have permission to record payments for this property.",
      )
      expect(dialog().get<HTMLInputElement>('#payment-amount').element.value).toBe('3000')
      expect(view!.find('[role="status"]').exists()).toBe(false)
      expect(fakeEntries.payments).toHaveLength(1)
    })

    it('retries an uncertain save with the same key, so the money is recorded once', async () => {
      // Recorded on the server, but the response was lost.
      const record = recordPaymentApi.getMockImplementation()!
      recordPaymentApi.mockImplementationOnce(async (...args) => {
        await record(...args)
        throw new ApiError('network')
      })
      await openDetails('tenant-001', 'sep')

      await recordPayment('3000')
      expect(dialog().get('[role="alert"]').text()).toBe(PAYMENT_UNCONFIRMED_MESSAGE)

      await dialog().get('form').trigger('submit')
      await flushPromises()

      const [first, retry] = recordPaymentApi.mock.calls
      expect(retry![3]).toBe(first![3])
      expect(fakeEntries.payments).toHaveLength(2)
      expect(view!.get('[role="status"]').text()).toBe('Payment of ₹3,000 was already recorded.')
      expect(section('payment')['Total paid']).toBe('₹13,000')
    })

    it('keeps the key for an uncertain save even if the dialog is closed and reopened', async () => {
      recordPaymentApi.mockRejectedValueOnce(new ApiError('unavailable'))
      await openDetails('tenant-001', 'sep')
      await recordPayment('3000')

      await dialog().get('button[type="button"]').trigger('click')
      await flushPromises()
      await recordPayment('3000')

      const [first, retry] = recordPaymentApi.mock.calls
      expect(retry![3]).toBe(first![3])
      expect(fakeEntries.payments).toHaveLength(2)
    })

    it('stays on this entry, with the dialog open, while a payment save is in flight', async () => {
      fakeEntries.entries = [entry, makeEntry({ id: 'aug', billingMonth: '2026-08' })]
      // Recorded on the server, but the response is lost after the user tried to leave.
      const record = recordPaymentApi.getMockImplementation()!
      let fail!: () => void
      recordPaymentApi.mockImplementationOnce(async (...args) => {
        await record(...args)
        await new Promise<void>((resolve) => (fail = resolve))
        throw new ApiError('network')
      })
      await openDetails('tenant-001', 'sep')
      await openDialog()
      await dialog().get('#payment-amount').setValue('3000')
      await dialog().get('form').trigger('submit')
      await flushPromises()

      expect(button('Back to Previous Entries').attributes('disabled')).toBeDefined()
      await router.push('/tenants/tenant-001/entries/aug')
      await router.push('/tenants/tenant-001/entries')
      await flushPromises()
      expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001', entryId: 'sep' })

      await dialog().get('button[data-slot="dialog-close"]').trigger('click')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()
      expect(body.find('[role="dialog"]').exists()).toBe(true)

      fail()
      await flushPromises()
      expect(dialog().get('[role="alert"]').text()).toBe(PAYMENT_UNCONFIRMED_MESSAGE)
      expect(button('Back to Previous Entries').attributes('disabled')).toBeUndefined()

      await dialog().get('form').trigger('submit')
      await flushPromises()

      const [first, retry] = recordPaymentApi.mock.calls
      expect(retry![3]).toBe(first![3])
      expect(fakeEntries.payments).toHaveLength(2)
    })

    it('keeps the key for an uncertain save after leaving the page and coming back', async () => {
      const record = recordPaymentApi.getMockImplementation()!
      recordPaymentApi.mockImplementationOnce(async (...args) => {
        await record(...args)
        throw new ApiError('network')
      })
      await openDetails('tenant-001', 'sep')
      await recordPayment('1000')
      expect(dialog().get('[role="alert"]').text()).toBe(PAYMENT_UNCONFIRMED_MESSAGE)

      await router.push('/tenants/tenant-001/entries')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('rent-entry-history')
      await router.push('/tenants/tenant-001/entries/sep')
      await flushPromises()
      await recordPayment('1000')

      const [first, retry] = recordPaymentApi.mock.calls
      expect(retry![3]).toBe(first![3])
      expect(fakeEntries.payments).toHaveLength(2)
      expect(view!.get('[role="status"]').text()).toBe('Payment of ₹1,000 was already recorded.')
    })

    it('starts a new payment after a definite rejection', async () => {
      recordPaymentApi.mockRejectedValueOnce(
        new ApiError('invalid-request', 'Bad', null, { notes: 'Too long.' }),
      )
      await openDetails('tenant-001', 'sep')

      await recordPayment('3000')
      expect(dialog().get('[role="alert"]').text()).toBe('Too long.')
      await submitPayment('3000')

      const [first, second] = recordPaymentApi.mock.calls
      expect(second![3]).not.toBe(first![3])
    })

    it('refreshes the balance when someone else paid meanwhile', async () => {
      await openDetails('tenant-001', 'sep')
      // Another device records ₹3,000: ₹1,712.50 is left.
      addFakePayment(makePayment({ id: 'p-other', entryId: 'sep', amount: 3000 }))

      await recordPayment('4712.50')

      expect(dialog().get('[role="alert"]').text()).toBe(
        'Amount cannot exceed the outstanding ₹1,712.50.',
      )
      expect(dialog().get('[data-testid="payment-bill"]').text()).toContain('₹1,712.50')
      expect(paymentRows()).toHaveLength(2)
    })

    it('says so when the save fails for an unknown reason', async () => {
      recordPaymentApi.mockRejectedValueOnce(new ApiError('conflict', 'x', 'something_else'))
      await openDetails('tenant-001', 'sep')

      await recordPayment('3000')

      expect(dialog().get('[role="alert"]').text()).toBe(PAYMENT_SAVE_ERROR_MESSAGE)
    })
  })
})
