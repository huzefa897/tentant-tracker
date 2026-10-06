import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RECEIPT_PDF_ERROR_MESSAGE, useReceiptDownload } from '@/composables/useReceiptDownload'
import { RECEIPT_SAVE_ERROR_MESSAGE, useRentEntryStore } from '@/stores/rentEntry'
import { makeEntry, makePayment, storeLedger } from '@/test/rentEntries'
import { downloadReceiptPdf } from '@/utils/receiptDownload'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import { resetTenantService } from '@/test/mocks/tenantService'
import { loadTestTenants } from '@/test/tenants'

vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

vi.mock('@/utils/receiptDownload', () => ({ downloadReceiptPdf: vi.fn() }))

const download = vi.mocked(downloadReceiptPdf)

async function setup() {
  storeLedger([makeEntry()], [makePayment()])
  await loadTestTenants()
  const store = useRentEntryStore()
  store.initialize()
  return { store, ...useReceiptDownload() }
}

beforeEach(() => {
  resetAuthService()
  resetAccessService()
  resetTenantService()
  localStorage.clear()
  setActivePinia(createPinia())
  download.mockReset()
  download.mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useReceiptDownload', () => {
  it('issues the payment’s receipt and downloads it', async () => {
    const { store, downloadReceipt, error } = await setup()

    expect(await downloadReceipt('payment-1')).toBe(true)

    const [receipt] = store.receipts
    expect(receipt).toMatchObject({ paymentId: 'payment-1', reference: 'RCP-202-202609' })
    expect(download).toHaveBeenCalledWith(receipt)
    expect(error.value).toBeNull()
  })

  it('downloads the same receipt again instead of issuing another', async () => {
    const { store, downloadReceipt } = await setup()

    await downloadReceipt('payment-1')
    await downloadReceipt('payment-1')

    expect(store.receipts).toHaveLength(1)
    expect(download.mock.calls[1]![0]).toEqual(store.receipts[0])
  })

  it('shows which payment is downloading, and ignores clicks meanwhile', async () => {
    const { downloadReceipt, downloadingPaymentId } = await setup()
    let finish!: () => void
    download.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))

    const first = downloadReceipt('payment-1')
    expect(downloadingPaymentId.value).toBe('payment-1')
    expect(await downloadReceipt('payment-1')).toBe(false)

    finish()
    await first
    expect(downloadingPaymentId.value).toBeNull()
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('reports a receipt that cannot be saved, without downloading', async () => {
    const { downloadReceipt, error } = await setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    expect(await downloadReceipt('payment-1')).toBe(false)

    expect(error.value).toBe(RECEIPT_SAVE_ERROR_MESSAGE)
    expect(download).not.toHaveBeenCalled()
  })

  it('keeps the issued receipt when the PDF fails, so a retry reuses it', async () => {
    const { store, downloadReceipt, error, clearError } = await setup()
    download.mockRejectedValueOnce(new Error('offline'))

    expect(await downloadReceipt('payment-1')).toBe(false)
    expect(error.value).toBe(RECEIPT_PDF_ERROR_MESSAGE)
    expect(store.receipts).toHaveLength(1)

    clearError()
    expect(error.value).toBeNull()
    expect(await downloadReceipt('payment-1')).toBe(true)
    expect(store.receipts).toHaveLength(1)
  })
})
