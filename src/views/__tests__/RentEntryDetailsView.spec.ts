import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { ApiError } from '@/services/apiError'
import { paymentService } from '@/services/payment.service'
import { receiptService } from '@/services/receipt.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { tenantService } from '@/services/tenant.service'
import {
  PAYMENT_SAVE_ERROR_MESSAGE,
  PAYMENT_UNCONFIRMED_MESSAGE,
  RECEIPT_UNCONFIRMED_MESSAGE,
} from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { makeEntry, makePayment, openPage } from '@/test/rentEntries'
import { accessService } from '@/services/access.service'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { fakeReceipts } from '@/test/mocks/receiptService'
import { resetTenantService, testTenants } from '@/test/mocks/tenantService'
import { downloadReceiptPdf } from '@/utils/receiptDownload'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
vi.mock('@/services/receipt.service', () => import('@/test/mocks/receiptService'))
vi.mock('@/utils/receiptDownload', () => ({ downloadReceiptPdf: vi.fn() }))

const getEntry = vi.mocked(rentEntryService.getEntry)
const recordPaymentApi = vi.mocked(paymentService.recordPayment)
const getPayments = vi.mocked(paymentService.getPayments)
const issueReceipt = vi.mocked(receiptService.issueReceipt)
const reversePaymentApi = vi.mocked(paymentService.reversePayment)
const downloadPdf = vi.mocked(downloadReceiptPdf)

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
  downloadPdf.mockReset().mockResolvedValue()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
})

describe('RentEntryDetailsView', () => {
  it('holds the page’s shape with a skeleton while the bill loads', async () => {
    let finish!: () => void
    const fakeGet = getEntry.getMockImplementation()!
    getEntry.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (finish = resolve))
      return fakeGet(...args)
    })
    await openDetails('tenant-001', 'sep')

    const loading = view!.get('[data-testid="entry-loading"]')
    expect(loading.attributes('role')).toBe('status')
    expect(loading.text()).toBe('Loading entry…')
    expect(loading.findAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)

    finish()
    await flushPromises()
    expect(view!.find('[data-testid="entry-loading"]').exists()).toBe(false)
    expect(view!.get('h1').text()).toBe('September 2026')
  })

  it('shows skeleton rows while the bill’s payments load', async () => {
    getPayments.mockReturnValueOnce(new Promise(() => {}))
    await openDetails('tenant-001', 'sep')

    expect(view!.get('[data-testid="payments-loading"]').text()).toBe('Loading payments…')
    expect(view!.text()).not.toContain('No payments recorded')
  })

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

  it('shows when the bill is due, and Overdue once that has passed with money owed', async () => {
    fakeEntries.entries = [
      makeEntry({
        ...entry,
        paymentTiming: 'postpaid',
        dueDate: '2026-10-11',
        dueStatus: 'overdue',
      }),
    ]
    await openDetails('tenant-001', 'sep')

    expect(view!.get('[data-testid="due-date"]').text()).toBe('Due 11 Oct 2026 · Postpaid')
    expect(view!.get('[data-testid="due-status-badge"]').text()).toBe('Overdue')
  })

  it('shows no due date for a bill from before due dates', async () => {
    fakeEntries.entries = [
      makeEntry({ ...entry, paymentTiming: null, dueDate: null, dueStatus: null }),
    ]
    await openDetails('tenant-001', 'sep')

    expect(view!.find('[data-testid="due-date"]').exists()).toBe(false)
    expect(view!.find('[data-testid="due-status-badge"]').exists()).toBe(false)
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

  it('shows the slow-load screen rather than Entry not found, then auto-retries', async () => {
    vi.useFakeTimers()
    try {
      view = await openPage('/tenants/tenant-001/entries/sep', () => {
        getEntry.mockRejectedValueOnce(new ApiError('unknown'))
      })

      expect(view.text()).toContain("It's taking longer than usual")
      expect(view.text()).not.toContain('Entry not found')

      vi.advanceTimersByTime(10_000)
      await flushPromises()

      expect(view.get('h1').text()).toBe('September 2026')
    } finally {
      vi.useRealTimers()
    }
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
  it('shows the slow-load screen instead of Loading or Tenant not found, then auto-retries', async () => {
    vi.useFakeTimers()
    try {
      view = await openPage('/tenants/tenant-001/entries/sep', () => {
        vi.mocked(tenantService.getTenant).mockRejectedValueOnce(new Error('boom'))
      })

      expect(view.text()).toContain("It's taking longer than usual")
      expect(view.text()).not.toContain('Loading')
      expect(view.text()).not.toContain('Tenant not found')

      vi.advanceTimersByTime(10_000)
      await flushPromises()

      expect(view.get('h1').text()).toBe('September 2026')
    } finally {
      vi.useRealTimers()
    }
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

    it('lists the bill’s payments from the API, each offering a receipt', async () => {
      await openDetails('tenant-001', 'sep')

      expect(getPayments).toHaveBeenCalledWith(expect.any(String), 'tenant-001', 'sep')
      expect(paymentRows()).toEqual([
        ['3 Oct 2026', '₹10,000', 'Initial payment', 'Issue receipt Reverse'],
      ])
    })

    it('shows skeleton on a failed payment load, never no payments, then auto-retries', async () => {
      vi.useFakeTimers()
      try {
        getPayments.mockRejectedValueOnce(new ApiError('network'))
        await openDetails('tenant-001', 'sep')

        expect(view!.text()).not.toContain('No payments recorded')
        expect(view!.find('[data-testid="payments-loading"]').exists()).toBe(true)

        vi.advanceTimersByTime(5000)
        await flushPromises()

        expect(paymentRows()).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
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

    describe('receipts', () => {
      function receiptButton() {
        return view!.get('[data-testid="download-receipt"]')
      }

      async function clickReceipt() {
        await receiptButton().trigger('click')
        await flushPromises()
      }

      it('issues the payment’s receipt in Django, then downloads its snapshot', async () => {
        await openDetails('tenant-001', 'sep')

        await clickReceipt()

        expect(issueReceipt).toHaveBeenCalledWith(expect.any(String), 'tenant-001', 'sep', 'p-1')
        expect(downloadPdf).toHaveBeenCalledWith(fakeReceipts.get('p-1'))
        expect(fakeReceipts.get('p-1')).toMatchObject({ paymentAmount: 10000 })
        expect(receiptButton().text()).toBe('Download receipt')
        expect(view!.find('[role="alert"]').exists()).toBe(false)
      })

      it('downloads the same receipt again without issuing another', async () => {
        await openDetails('tenant-001', 'sep')
        await clickReceipt()

        await clickReceipt()

        expect(issueReceipt).toHaveBeenCalledTimes(1)
        expect(downloadPdf).toHaveBeenCalledTimes(2)
        expect(downloadPdf.mock.calls[1]![0]).toBe(downloadPdf.mock.calls[0]![0])
      })

      it('shows Preparing… and disables the buttons while the receipt is issued', async () => {
        let finish!: () => void
        const issue = issueReceipt.getMockImplementation()!
        issueReceipt.mockImplementationOnce(async (...args) => {
          await new Promise<void>((resolve) => (finish = resolve))
          return issue(...args)
        })
        await openDetails('tenant-001', 'sep')

        await receiptButton().trigger('click')
        expect(receiptButton().text()).toBe('Preparing…')
        expect(receiptButton().attributes('disabled')).toBeDefined()

        finish()
        await flushPromises()
        expect(receiptButton().text()).toBe('Download receipt')
      })

      it('says what to configure when the backend refuses, keeping the payment', async () => {
        issueReceipt.mockRejectedValueOnce(
          new ApiError('invalid-request', 'x', 'receipt_configuration_incomplete', {
            detail: 'Configure the property address before issuing receipts.',
          }),
        )
        await openDetails('tenant-001', 'sep')

        await clickReceipt()

        expect(view!.get('[role="alert"]').text()).toBe(
          'Configure the property address before issuing receipts.',
        )
        expect(downloadPdf).not.toHaveBeenCalled()
        expect(paymentRows()).toEqual([
          ['3 Oct 2026', '₹10,000', 'Initial payment', 'Issue receipt Reverse'],
        ])
        expect(fakeEntries.payments).toHaveLength(1)
      })

      it('retries after a lost response and gets the receipt already issued', async () => {
        const issue = issueReceipt.getMockImplementation()!
        issueReceipt.mockImplementationOnce(async (...args) => {
          await issue(...args)
          throw new ApiError('network')
        })
        await openDetails('tenant-001', 'sep')

        await clickReceipt()
        expect(view!.get('[role="alert"]').text()).toBe(RECEIPT_UNCONFIRMED_MESSAGE)

        await clickReceipt()

        expect(view!.find('[role="alert"]').exists()).toBe(false)
        expect(fakeReceipts.size).toBe(1)
        expect(downloadPdf).toHaveBeenCalledWith(fakeReceipts.get('p-1'))
      })

      it('says the receipt is issued when only its PDF fails', async () => {
        downloadPdf.mockRejectedValueOnce(new Error('offline'))
        await openDetails('tenant-001', 'sep')

        await clickReceipt()

        const reference = fakeReceipts.get('p-1')!.reference
        expect(view!.get('[role="alert"]').text()).toBe(
          `Receipt ${reference} is issued, but its PDF couldn't be made. Check your connection and try again.`,
        )
        expect(receiptButton().text()).toBe('Download receipt')
      })
    })

    it('says so when the save fails for an unknown reason', async () => {
      recordPaymentApi.mockRejectedValueOnce(new ApiError('conflict', 'x', 'something_else'))
      await openDetails('tenant-001', 'sep')

      await recordPayment('3000')

      expect(dialog().get('[role="alert"]').text()).toBe(PAYMENT_SAVE_ERROR_MESSAGE)
    })

    describe('reversing payments', () => {
      const REASON = 'Entered ₹10,000 instead of ₹1,000.'

      async function openReversal() {
        await view!.get('[data-testid="reverse-payment"]').trigger('click')
        await flushPromises()
      }

      async function submitReversal(reason = REASON) {
        await dialog().get('#reversal-reason').setValue(reason)
        await dialog().get('form').trigger('submit')
        await flushPromises()
      }

      it('confirms what is being reversed and what reversing does', async () => {
        await openDetails('tenant-001', 'sep')

        await openReversal()

        expect(dialog().text()).toContain('Reverse payment')
        const details = dialog().get('[data-testid="reversal-payment"]').text()
        for (const part of [
          'Shaik Zahid Ali · Flat 202',
          'September 2026',
          '3 Oct 2026',
          '₹10,000',
        ]) {
          expect(details).toContain(part)
        }
        expect(dialog().get('[data-testid="reversal-effects"]').text()).toContain(
          'No money is refunded',
        )
        expect(dialog().text()).not.toContain('VOID')
      })

      it('warns that an issued receipt will be voided', async () => {
        await openDetails('tenant-001', 'sep')
        await view!.get('[data-testid="download-receipt"]').trigger('click')
        await flushPromises()

        await openReversal()

        expect(dialog().get('[data-testid="reversal-effects"]').text()).toContain(
          `Its receipt ${fakeReceipts.get('p-1')!.reference} will be marked VOID`,
        )
      })

      it('needs a reason before anything is sent', async () => {
        await openDetails('tenant-001', 'sep')
        await openReversal()

        await submitReversal('   ')

        expect(dialog().get('#reversal-reason-error').text()).toBe(
          'Say why this payment is being reversed.',
        )
        expect(reversePaymentApi).not.toHaveBeenCalled()
      })

      it('cancelling changes nothing', async () => {
        await openDetails('tenant-001', 'sep')
        await openReversal()

        await dialog()
          .findAll('button')
          .find((b) => b.text() === 'Cancel')!
          .trigger('click')
        await flushPromises()

        expect(body.find('[role="dialog"]').exists()).toBe(false)
        expect(reversePaymentApi).not.toHaveBeenCalled()
        expect(section('payment')['Total paid']).toBe('₹10,000')
      })

      it('shows the payment reversed and the bill without it, then offers its replacement', async () => {
        await openDetails('tenant-001', 'sep')
        await openReversal()

        await submitReversal()

        expect(reversePaymentApi).toHaveBeenCalledWith(
          expect.any(String),
          'tenant-001',
          expect.objectContaining({ id: 'p-1' }),
          REASON,
        )
        expect(body.find('[role="dialog"]').exists()).toBe(false)
        expect(view!.get('[role="status"]').text()).toBe('Payment of ₹10,000 reversed.')
        expect(section('payment')).toMatchObject({
          'Total paid': '₹0',
          Outstanding: '₹14,712.50',
        })
        const row = view!.get('[data-testid="payment-row"]')
        expect(row.attributes('data-status')).toBe('reversed')
        expect(row.get('[data-testid="reversal-reason"]').text()).toContain(REASON)
        // A reversed payment can't be reversed again, nor get a new receipt.
        expect(row.find('[data-testid="reverse-payment"]').exists()).toBe(false)
        expect(row.find('[data-testid="download-receipt"]').exists()).toBe(false)

        await view!.get('[data-testid="record-replacement"]').trigger('click')
        await flushPromises()
        // Never pre-filled with the reversed amount.
        expect((dialog().get('#payment-amount').element as HTMLInputElement).value).toBe('')
        await submitPayment('1000')
        expect(section('payment')['Total paid']).toBe('₹1,000')
      })

      it('keeps a voided receipt downloadable, marked void', async () => {
        await openDetails('tenant-001', 'sep')
        await view!.get('[data-testid="download-receipt"]').trigger('click')
        await flushPromises()
        await openReversal()

        await submitReversal()

        expect(view!.get('[role="status"]').text()).toBe(
          'Payment of ₹10,000 reversed. Its receipt is now void.',
        )
        const download = view!.get('[data-testid="download-receipt"]')
        expect(download.text()).toBe('Download void receipt')
        await download.trigger('click')
        await flushPromises()
        expect(downloadPdf).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: 'void', voidReason: REASON }),
        )
      })

      it('keeps the dialog and the reason when the reversal fails', async () => {
        reversePaymentApi.mockRejectedValueOnce(new ApiError('forbidden'))
        await openDetails('tenant-001', 'sep')
        await openReversal()

        await submitReversal()

        expect(dialog().text()).toContain("Only the property's owners can reverse payments.")
        expect((dialog().get('#reversal-reason').element as HTMLTextAreaElement).value).toBe(REASON)
        expect(section('payment')['Total paid']).toBe('₹10,000')
      })

      it('stays on this entry, with the dialog open, while a reversal is in flight', async () => {
        fakeEntries.entries = [entry, makeEntry({ id: 'aug', billingMonth: '2026-08' })]
        let finish!: () => void
        const reverse = reversePaymentApi.getMockImplementation()!
        reversePaymentApi.mockImplementationOnce(async (...args) => {
          await new Promise<void>((resolve) => (finish = resolve))
          return reverse(...args)
        })
        await openDetails('tenant-001', 'sep')
        await openReversal()
        await dialog().get('#reversal-reason').setValue(REASON)
        await dialog().get('form').trigger('submit')
        await flushPromises()

        expect(button('Back to Previous Entries').attributes('disabled')).toBeDefined()
        await router.push('/tenants/tenant-001/entries/aug')
        await flushPromises()
        expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001', entryId: 'sep' })
        expect(body.find('[role="dialog"]').exists()).toBe(true)

        finish()
        await flushPromises()
        expect(view!.get('[role="status"]').text()).toBe('Payment of ₹10,000 reversed.')
      })

      it('offers reversing to a manager too', async () => {
        vi.mocked(accessService.getMe).mockResolvedValue(
          identityWith([{ ...testProperty, role: 'manager' }]),
        )
        await openDetails('tenant-001', 'sep')

        expect(paymentRows()).toEqual([
          ['3 Oct 2026', '₹10,000', 'Initial payment', 'Issue receipt Reverse'],
        ])
      })
    })
  })
})

describe('RentEntryDetailsView for voiding and correcting bills', () => {
  const body = new DOMWrapper(document.body)
  const voidEntryApi = vi.mocked(rentEntryService.voidEntry)
  const REASON = 'Entered twice for September.'

  function dialog() {
    return body.get('[role="dialog"]')
  }

  async function openVoid() {
    await button('Void bill').trigger('click')
    await flushPromises()
  }

  it('offers owners Correct bill and Void bill on an active bill', async () => {
    await openDetails('tenant-001', 'sep')

    expect(
      view!
        .get('[data-testid="bill-actions"]')
        .findAll('button')
        .map((b) => b.text()),
    ).toEqual(['Correct bill', 'Void bill'])
  })

  it('never offers them to a manager', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(
      identityWith([{ ...testProperty, role: 'manager' }]),
    )
    await openDetails('tenant-001', 'sep')

    expect(view!.find('[data-testid="bill-actions"]').exists()).toBe(false)
  })

  it('opens the correction page', async () => {
    await openDetails('tenant-001', 'sep')

    await button('Correct bill').trigger('click')

    // The page loads on demand.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-correct'))
    expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001', entryId: 'sep' })
  })

  it('voids a bill with no payments, then shows it VOID and owing nothing', async () => {
    await openDetails('tenant-001', 'sep')
    await openVoid()

    await dialog().get('#void-reason').setValue(REASON)
    await dialog().get('form').trigger('submit')
    await flushPromises()

    expect(voidEntryApi).toHaveBeenCalledWith(expect.any(String), 'tenant-001', 'sep', REASON)
    expect(body.find('[role="dialog"]').exists()).toBe(false)
    expect(view!.get('[role="status"]').text()).toBe('Bill voided.')
    expect(view!.get('[data-testid="void-badge"]').text()).toBe('Void')
    const notice = view!.get('[data-testid="void-notice"]').text()
    expect(notice).toContain('VOID')
    expect(notice).toContain(`Voided by Test Owner on`)
    expect(notice).toContain(REASON)
    expect(section('payment')).toMatchObject({ 'Total due': '₹14,712.50', Outstanding: '₹0' })
    expect(view!.find('[data-testid="void-owes-nothing"]').exists()).toBe(true)
    expect(view!.findAll('button').some((b) => b.text() === 'Record Payment')).toBe(false)
    expect(view!.find('[data-testid="bill-actions"]').exists()).toBe(false)
  })

  it('lists the payments to reverse first, and voids nothing', async () => {
    addFakePayment(makePayment({ id: 'p-1', entryId: 'sep', amount: 1000 }))
    await openDetails('tenant-001', 'sep')
    await openVoid()

    expect(dialog().get('[data-testid="payments-to-reverse"]').text()).toContain(
      'Reverse this payment first',
    )
    expect(dialog().find('#void-reason').exists()).toBe(false)
    expect(voidEntryApi).not.toHaveBeenCalled()
  })

  it('keeps the dialog and the reason when voiding fails', async () => {
    voidEntryApi.mockRejectedValueOnce(new ApiError('forbidden'))
    await openDetails('tenant-001', 'sep')
    await openVoid()

    await dialog().get('#void-reason').setValue(REASON)
    await dialog().get('form').trigger('submit')
    await flushPromises()

    expect(dialog().text()).toContain("Only the property's owners can void or correct bills.")
    expect((dialog().get('#void-reason').element as HTMLTextAreaElement).value).toBe(REASON)
    expect(view!.find('[data-testid="void-notice"]').exists()).toBe(false)
  })

  it('links a corrected bill and its replacement both ways', async () => {
    fakeEntries.entries = [
      makeEntry({
        id: 'sep',
        billingMonth: '2026-09',
        billStatus: 'void',
        replacedByEntryId: 'sep-2',
      }),
      makeEntry({ id: 'sep-2', billingMonth: '2026-09', replacesEntryId: 'sep' }),
    ]
    await openDetails('tenant-001', 'sep')

    const toReplacement = view!.get('[data-testid="correction-links"] a')
    expect(toReplacement.text()).toBe('Replaced by bill · September 2026')
    expect(toReplacement.attributes('href')).toBe('/tenants/tenant-001/entries/sep-2')

    await toReplacement.trigger('click')
    await flushPromises()

    expect(view!.find('[data-testid="void-notice"]').exists()).toBe(false)
    const toOriginal = view!.get('[data-testid="correction-links"] a')
    expect(toOriginal.text()).toBe('Replaces void bill · September 2026')
    expect(toOriginal.attributes('href')).toBe('/tenants/tenant-001/entries/sep')
  })

  it('confirms a correction on the replacement it opens', async () => {
    fakeEntries.entries = [makeEntry({ id: 'sep-2', replacesEntryId: 'sep' })]

    await openDetails('tenant-001', 'sep-2', '?corrected=1')

    expect(view!.get('[role="status"]').text()).toBe(
      'Bill corrected. The original is now void and counts towards nothing.',
    )
  })
})
