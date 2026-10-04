import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { LOAD_ERROR_MESSAGE } from '@/stores/rentEntry'
import { makeEntry, makePayment, makeReceipt, openPage, storeLedger } from '@/test/rentEntries'
import { RENT_LEDGER_STORAGE_KEY } from '@/utils/rentLedgerStorage'

vi.mock('@/services/auth.service', () => ({
  authService: { sendOtp: vi.fn(), verifyOtp: vi.fn(), logout: vi.fn() },
}))

let view: VueWrapper | undefined

async function openReceipt(path = '/tenants/tenant-001/entries/entry-1/receipts/receipt-1') {
  view = await openPage(path)
  return view
}

function button(label: string) {
  const match = view!.findAll('button').find((b) => b.text() === label)
  if (!match) throw new Error(`No "${label}" button`)
  return match
}

// A ₹15,750 bill with two payments; only the ₹3,000 one has a receipt.
const entry = makeEntry()
const payments = [
  makePayment({ id: 'payment-1', amount: 3000, paidDate: '2026-10-03', notes: 'Bank transfer' }),
  makePayment({ id: 'payment-2', amount: 5000, paidDate: '2026-10-10' }),
]
// Issued when the tenant had a different name: the snapshot is what shows.
const receipt = makeReceipt({
  reference: 'RCP-202-202609',
  paymentAmount: 3000,
  totalPaid: 3000,
  outstanding: 12750,
  paidDate: '2026-10-03',
  paymentNotes: 'Bank transfer',
  tenant: { ...makeReceipt().tenant, name: 'Name When Issued' },
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

describe('PaymentReceiptView', () => {
  it('loads the saved receipt from a direct link, as issued', async () => {
    storeLedger([entry], payments, [receipt])
    await openReceipt()

    expect(view!.get('[data-testid="receipt-reference"]').text()).toBe('RCP-202-202609')
    expect(view!.get('[data-testid="receipt-amount"]').text()).toBe('₹3,000.00')
    expect(view!.get('[data-testid="receipt-tenant"]').text()).toBe(': Name When Issued')
    expect(view!.text()).not.toContain('Shaik Zahid Ali')
  })

  it('shows the same reference after a refresh', async () => {
    storeLedger([entry], payments, [receipt])
    await openReceipt()
    view!.unmount()

    await openReceipt()

    expect(view!.get('[data-testid="receipt-reference"]').text()).toBe('RCP-202-202609')
  })

  it.each([
    ['an unknown receipt', '/tenants/tenant-001/entries/entry-1/receipts/missing'],
    ['another entry’s URL', '/tenants/tenant-001/entries/entry-2/receipts/receipt-1'],
    ['another tenant’s URL', '/tenants/tenant-002/entries/entry-1/receipts/receipt-1'],
  ])('shows Receipt not found for %s', async (_, path) => {
    const other = makeEntry({ id: 'entry-2', billingMonth: '2026-10' })
    storeLedger([entry, other], payments, [receipt])
    await openReceipt(path)

    expect(view!.get('[role="alert"]').text()).toContain('Receipt not found')
    expect(view!.find('[data-testid="receipt-reference"]').exists()).toBe(false)
  })

  it('shows a load error rather than Receipt not found, then retries', async () => {
    localStorage.setItem(RENT_LEDGER_STORAGE_KEY, '{not json')
    await openReceipt()

    expect(view!.get('[role="alert"]').text()).toContain(LOAD_ERROR_MESSAGE)

    storeLedger([entry], payments, [receipt])
    await button('Retry').trigger('click')
    await flushPromises()

    expect(view!.get('[data-testid="receipt-amount"]').text()).toBe('₹3,000.00')
  })

  it('opens the print dialog without changing the ledger or claiming success', async () => {
    storeLedger([entry], payments, [receipt])
    await openReceipt()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const before = localStorage.getItem(RENT_LEDGER_STORAGE_KEY)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await button('Print / Save as PDF').trigger('click')
    await flushPromises()

    expect(print).toHaveBeenCalledTimes(1)
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(RENT_LEDGER_STORAGE_KEY)).toBe(before)
    expect(view!.find('[role="status"]').exists()).toBe(false)
    expect(view!.text()).not.toMatch(/printed|downloaded/i)
  })

  it('keeps the toolbar outside the receipt document, so printing can hide it', async () => {
    storeLedger([entry], payments, [receipt])
    await openReceipt()

    const toolbar = view!.get('.receipt-toolbar')
    expect(toolbar.text()).toContain('Print / Save as PDF')
    expect(view!.get('.receipt-document').find('button').exists()).toBe(false)
  })

  it('goes back to the entry by route', async () => {
    storeLedger([entry], payments, [receipt])
    await openReceipt()

    await button('Back to Entry').trigger('click')

    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/tenants/tenant-001/entries/entry-1'),
    )
  })
})
