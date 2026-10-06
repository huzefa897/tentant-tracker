import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { tenantService } from '@/services/tenant.service'
import {
  LOAD_ERROR_MESSAGE,
  RECEIPT_SAVE_ERROR_MESSAGE,
  SAVE_ERROR_MESSAGE,
  useRentEntryStore,
} from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { RECEIPT_PDF_ERROR_MESSAGE } from '@/composables/useReceiptDownload'
import { makeEntry, makePayment, openPage, storeEntries, storeLedger } from '@/test/rentEntries'
import { downloadReceiptPdf } from '@/utils/receiptDownload'
import { RENT_LEDGER_STORAGE_KEY } from '@/utils/rentLedgerStorage'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import { resetTenantService, testTenants } from '@/test/mocks/tenantService'

// The PDF itself is covered by its own tests; here, which receipt gets downloaded.
vi.mock('@/utils/receiptDownload', () => ({ downloadReceiptPdf: vi.fn() }))

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))

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

// ₹10,000 of the ₹14,712.50 due, paid in two parts.
const payments = [
  makePayment({ id: 'p1', entryId: 'sep', amount: 6000, paidDate: '2026-10-01', notes: 'Cash' }),
  makePayment({ id: 'p2', entryId: 'sep', amount: 4000, paidDate: '2026-10-02', notes: 'UPI' }),
]

function storeWithPayments() {
  storeLedger([entry], payments)
}

// Date, amount and notes; the receipt action is checked separately.
function paymentRows() {
  return view!
    .findAll('[data-testid="payment-row"]')
    .map((row) => row.findAll('td').map((cell) => cell.text()))
    .map((cells) => cells.slice(0, 3))
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
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
    expect(testTenants[0]).toMatchObject({ rentAmount: 15000, electricityRate: 6 })
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

  it('shows figures derived from the payment records, and the status', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')

    expect(section('payment')).toEqual({
      'Total due': '₹14,712.50',
      'Total paid': '₹10,000',
      Outstanding: '₹4,712.50',
    })
    expect(view!.text()).toContain('Partially paid')
  })

  it('lists every payment, newest first', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')

    expect(paymentRows()).toEqual([
      ['2 Oct 2026', '₹4,000', 'UPI'],
      ['1 Oct 2026', '₹6,000', 'Cash'],
    ])
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

  it('says when no payments or notes are recorded', async () => {
    storeEntries(makeEntry({ id: 'unpaid' }))
    await openDetails('tenant-001', 'unpaid')

    expect(view!.text()).toContain('No payments recorded for this entry.')
    expect(section('payment')['Total paid']).toBe('₹0')
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
    localStorage.setItem(RENT_LEDGER_STORAGE_KEY, '{not json')
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

  it('goes back to the dashboard, with the tenant selected, when opened from there', async () => {
    storeEntries(entry)
    await openDetails('tenant-001', 'sep', '?from=dashboard')

    expect(view!.text()).not.toContain('Back to Previous Entries')
    await button('Back to Dashboard').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('dashboard'))
    expect(useTenantStore().selectedTenantId).toBe('tenant-001')
  })

  it('ignores an unknown entry point and goes back to the history', async () => {
    storeEntries(entry)
    await openDetails('tenant-001', 'sep', '?from=elsewhere')

    await button('Back to Previous Entries').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
  })
})

describe('RentEntryDetailsView when the URL changes in place', () => {
  it('shows the new entry without a reload', async () => {
    storeEntries(entry, makeEntry({ id: 'aug', billingMonth: '2026-08' }))
    await openDetails('tenant-001', 'sep')

    await router.push('/tenants/tenant-001/entries/aug')
    await flushPromises()

    expect(view!.get('h1').text()).toBe('August 2026')
  })
})

describe('RentEntryDetailsView when tenants fail to load', () => {
  it('shows the error with Retry instead of Loading or Tenant not found, then recovers', async () => {
    storeEntries(entry)
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

describe('RentEntryDetailsView recording a payment', () => {
  const body = new DOMWrapper(document.body)

  function dialog() {
    return body.get('[role="dialog"]')
  }

  async function openDialog() {
    await button('Record Payment').trigger('click')
    await flushPromises()
  }

  async function recordPayment(amount: string, notes = '') {
    await openDialog()
    await dialog().get('#payment-amount').setValue(amount)
    await dialog().get('#payment-notes').setValue(notes)
    await dialog().get('form').trigger('submit')
    await flushPromises()
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the bill and its outstanding amount in the dialog', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')
    await openDialog()

    expect(dialog().text()).toContain('Record Payment')
    expect(dialog().get('[data-testid="payment-bill"]').text()).toContain('September 2026')
    expect(dialog().get('[data-testid="payment-bill"]').text()).toContain('₹4,712.50')
  })

  it('adds a payment, keeping the earlier ones, and confirms', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')

    await recordPayment('3000', 'Bank transfer')

    expect(body.find('[role="dialog"]').exists()).toBe(false)
    expect(view!.get('[role="status"]').text()).toBe('Payment of ₹3,000 recorded.')
    expect(section('payment')).toEqual({
      'Total due': '₹14,712.50',
      'Total paid': '₹13,000',
      Outstanding: '₹1,712.50',
    })
    expect(paymentRows()).toEqual([
      ['3 Oct 2026', '₹3,000', 'Bank transfer'],
      ['2 Oct 2026', '₹4,000', 'UPI'],
      ['1 Oct 2026', '₹6,000', 'Cash'],
    ])
  })

  // Each payment needs its own id: reusing one would reject the second as already recorded.
  it('records a second payment after reopening the dialog', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')

    await recordPayment('1000', 'First')
    await recordPayment('2000', 'Second')

    expect(body.find('[role="dialog"]').exists()).toBe(false)
    expect(view!.get('[role="status"]').text()).toBe('Payment of ₹2,000 recorded.')
    expect(paymentRows()).toHaveLength(4)
    expect(section('payment')['Total paid']).toBe('₹13,000')
  })

  it('keeps the payment after a refresh', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')
    await recordPayment('3000')
    view!.unmount()

    await openDetails('tenant-001', 'sep')

    expect(paymentRows()).toHaveLength(3)
    expect(section('payment')['Total paid']).toBe('₹13,000')
  })

  it('settles the bill with the exact outstanding amount and disables more payments', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')

    await recordPayment('4712.50')

    expect(section('payment').Outstanding).toBe('₹0')
    expect(view!.text()).toContain('Paid')
    expect(view!.get('[data-testid="fully-paid"]').text()).toBe('Fully paid')
    expect(view!.findAll('button').some((b) => b.text() === 'Record Payment')).toBe(false)
  })

  it('shows Fully paid instead of Record Payment for a paid bill', async () => {
    storeLedger([entry], [makePayment({ entryId: 'sep', amount: 14712.5 })])
    await openDetails('tenant-001', 'sep')

    expect(view!.find('[data-testid="fully-paid"]').exists()).toBe(true)
    expect(view!.findAll('button').some((b) => b.text() === 'Record Payment')).toBe(false)
  })

  it('blocks a payment over the outstanding amount', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')

    await recordPayment('5000')

    expect(dialog().get('#payment-amount-error').text()).toBe(
      'Amount cannot exceed the outstanding ₹4,712.50.',
    )
    expect(useRentEntryStore().getTotalPaid('sep')).toBe(10000)
    expect(view!.find('[role="status"]').exists()).toBe(false)
  })

  it('keeps the dialog and values open, without confirming, when writing fails', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')
    const before = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    await recordPayment('3000')

    expect(dialog().get('[role="alert"]').text()).toBe(SAVE_ERROR_MESSAGE)
    expect(dialog().get<HTMLInputElement>('#payment-amount').element.value).toBe('3000')
    expect(view!.find('[role="status"]').exists()).toBe(false)
    expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(before)
    expect(paymentRows()).toHaveLength(2)
  })

  it('saves on retry once storage works again, recording the payment once', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    await recordPayment('3000')

    await dialog().get('form').trigger('submit')
    await flushPromises()

    expect(body.find('[role="dialog"]').exists()).toBe(false)
    expect(paymentRows()).toHaveLength(3)
  })
})

describe('RentEntryDetailsView receipts', () => {
  const download = vi.mocked(downloadReceiptPdf)

  beforeEach(() => {
    download.mockReset()
    download.mockResolvedValue()
  })

  function rowButton(paidDate: string) {
    const row = view!
      .findAll('[data-testid="payment-row"]')
      .find((item) => item.get('td').text() === paidDate)
    return row!.get('[data-testid="download-receipt"]')
  }

  it('offers a receipt download for every payment', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')

    expect(view!.findAll('[data-testid="download-receipt"]').map((b) => b.text())).toEqual([
      'Download receipt',
      'Download receipt',
    ])
  })

  it('issues that payment’s receipt and downloads it, staying on the page', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')

    await rowButton('2 Oct 2026').trigger('click')
    await flushPromises()

    const [receipt] = useRentEntryStore().receipts
    expect(receipt).toMatchObject({
      paymentId: 'p2',
      paymentAmount: 4000,
      reference: 'RCP-202-202609-2',
      totalPaid: 10000,
      outstanding: 4712.5,
    })
    expect(download).toHaveBeenCalledWith(receipt)
    expect(router.currentRoute.value.name).toBe('rent-entry-details')
  })

  it('downloads an already issued receipt without issuing another', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')
    const issued = useRentEntryStore().issueReceipt('p1')

    await rowButton('1 Oct 2026').trigger('click')
    await flushPromises()

    expect(download).toHaveBeenCalledWith(issued)
    expect(useRentEntryStore().receipts).toHaveLength(1)
  })

  it('shows an inline error, and keeps the payment, when the receipt cannot be saved', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')
    const before = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    await rowButton('2 Oct 2026').trigger('click')
    await flushPromises()

    expect(view!.get('[data-testid="receipt-error"]').text()).toBe(RECEIPT_SAVE_ERROR_MESSAGE)
    expect(download).not.toHaveBeenCalled()
    expect(paymentRows()).toHaveLength(2)
    expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(before)
  })

  it('shows an inline error when the PDF cannot be created', async () => {
    storeWithPayments()
    await openDetails('tenant-001', 'sep')
    download.mockRejectedValueOnce(new Error('offline'))

    await rowButton('2 Oct 2026').trigger('click')
    await flushPromises()

    expect(view!.get('[data-testid="receipt-error"]').text()).toBe(RECEIPT_PDF_ERROR_MESSAGE)
  })
})
