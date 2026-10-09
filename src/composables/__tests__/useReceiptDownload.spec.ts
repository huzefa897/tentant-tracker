import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useReceiptDownload } from '@/composables/useReceiptDownload'
import { RECEIPT_ERROR_MESSAGE, ReceiptError } from '@/stores/rentEntry'
import { makePayment, makeReceipt } from '@/test/rentEntryFixtures'
import type { PaymentReceipt } from '@/types/receipt'
import { downloadReceiptPdf } from '@/utils/receiptDownload'

const store = vi.hoisted(() => ({ getReceipt: vi.fn(), getLatestReceipt: vi.fn() }))

vi.mock('@/stores/rentEntry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/rentEntry')>()),
  useRentEntryStore: () => store,
}))
vi.mock('@/utils/receiptDownload', () => ({ downloadReceiptPdf: vi.fn() }))

const downloadPdf = vi.mocked(downloadReceiptPdf)

// A receipt request that finishes when the test says.
function pending() {
  let resolve!: (receipt: PaymentReceipt) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<PaymentReceipt>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  downloadPdf.mockResolvedValue()
})

describe('useReceiptDownload', () => {
  it('downloads a payment’s receipt, waiting while it’s prepared', async () => {
    const receipt = makeReceipt()
    const request = pending()
    store.getReceipt.mockReturnValueOnce(request.promise)
    const payment = makePayment({ id: 'p-1' })
    const { downloadingId, error, downloadPaymentReceipt } = useReceiptDownload()

    const done = downloadPaymentReceipt('tenant-001', payment)
    expect(downloadingId.value).toBe('p-1')
    request.resolve(receipt)
    await done

    expect(store.getReceipt).toHaveBeenCalledWith('tenant-001', payment)
    expect(downloadPdf).toHaveBeenCalledWith(receipt)
    expect(downloadingId.value).toBeNull()
    expect(error.value).toBeNull()
  })

  it('downloads a bill’s latest receipt', async () => {
    const receipt = makeReceipt()
    store.getLatestReceipt.mockResolvedValueOnce(receipt)
    const { downloadLatestReceipt } = useReceiptDownload()

    await downloadLatestReceipt('tenant-001', 'sep')

    expect(store.getLatestReceipt).toHaveBeenCalledWith('tenant-001', 'sep')
    expect(downloadPdf).toHaveBeenCalledWith(receipt)
  })

  it('runs one download at a time', async () => {
    const request = pending()
    store.getLatestReceipt.mockReturnValueOnce(request.promise)
    const { downloadLatestReceipt } = useReceiptDownload()

    const first = downloadLatestReceipt('tenant-001', 'sep')
    await downloadLatestReceipt('tenant-001', 'oct')
    request.resolve(makeReceipt())
    await first

    expect(store.getLatestReceipt).toHaveBeenCalledTimes(1)
  })

  it('shows the store’s message, or a general one, when the receipt fails', async () => {
    const { error, downloadLatestReceipt } = useReceiptDownload()

    store.getLatestReceipt.mockRejectedValueOnce(new ReceiptError('No payments yet.'))
    await downloadLatestReceipt('tenant-001', 'sep')
    expect(error.value).toBe('No payments yet.')

    store.getLatestReceipt.mockRejectedValueOnce(new Error('boom'))
    await downloadLatestReceipt('tenant-001', 'sep')
    expect(error.value).toBe(RECEIPT_ERROR_MESSAGE)
    expect(downloadPdf).not.toHaveBeenCalled()
  })

  it('says the receipt is issued when only its PDF fails', async () => {
    store.getLatestReceipt.mockResolvedValueOnce(makeReceipt({ reference: 'Ref_1' }))
    downloadPdf.mockRejectedValueOnce(new Error('offline'))
    const { error, downloadLatestReceipt } = useReceiptDownload()

    await downloadLatestReceipt('tenant-001', 'sep')

    expect(error.value).toBe(
      "Receipt Ref_1 is issued, but its PDF couldn't be made. Check your connection and try again.",
    )
  })

  it('after reset, an earlier download’s error and wait no longer show', async () => {
    const earlier = pending()
    store.getLatestReceipt.mockReturnValueOnce(earlier.promise)
    const { downloadingId, error, downloadLatestReceipt, reset } = useReceiptDownload()

    const first = downloadLatestReceipt('tenant-001', 'sep')
    reset()
    expect(downloadingId.value).toBeNull()

    // Another tenant's bill can be downloaded straight away.
    const later = pending()
    store.getLatestReceipt.mockReturnValueOnce(later.promise)
    const second = downloadLatestReceipt('tenant-002', 'oct')
    earlier.reject(new ReceiptError('The earlier bill failed.'))
    await first

    expect(error.value).toBeNull()
    expect(downloadingId.value).toBe('oct')

    later.resolve(makeReceipt())
    await second
    expect(downloadingId.value).toBeNull()
  })
})
