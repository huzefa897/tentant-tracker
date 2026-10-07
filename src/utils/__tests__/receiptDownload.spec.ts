import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeReceipt } from '@/test/rentEntries'

const save = vi.fn()
const renderReceiptPdf = vi.fn(() => ({ save }))
vi.mock('@/utils/receiptPdf', () => ({ renderReceiptPdf }))

// A fresh module each time, so the font cache starts empty.
async function load() {
  vi.resetModules()
  return import('@/utils/receiptDownload')
}

function fontResponse(bytes: number[]) {
  return new Response(new Uint8Array(bytes))
}

beforeEach(() => {
  save.mockClear()
  renderReceiptPdf.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('downloadReceiptPdf', () => {
  it('renders the receipt with the fonts and saves it under its file name', async () => {
    const fetch = vi.fn(async (url: string) =>
      fontResponse(url.includes('Bold') ? [4, 5, 6] : [1, 2, 3]),
    )
    vi.stubGlobal('fetch', fetch)
    const { downloadReceiptPdf } = await load()

    await downloadReceiptPdf(makeReceipt())

    expect(renderReceiptPdf).toHaveBeenCalledWith(
      expect.objectContaining({ receiptNumber: 'RCT-0b7c9e52-4f1a-4d3e-9a8b-1c2d3e4f5a6b' }),
      { regular: btoa('\x01\x02\x03'), bold: btoa('\x04\x05\x06') },
    )
    expect(save).toHaveBeenCalledWith(
      'Shaik Zahid Ali 202 Rent September 2026 RCT-0b7c9e52-4f1a-4d3e-9a8b-1c2d3e4f5a6b.pdf',
    )
  })

  it('loads the fonts once for several downloads', async () => {
    const fetch = vi.fn(async () => fontResponse([1]))
    vi.stubGlobal('fetch', fetch)
    const { downloadReceiptPdf } = await load()

    await downloadReceiptPdf(makeReceipt())
    await downloadReceiptPdf(makeReceipt())

    expect(fetch).toHaveBeenCalledTimes(2) // regular and bold, once each
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('fails without saving when the fonts cannot load, and tries again next time', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    const { downloadReceiptPdf } = await load()

    await expect(downloadReceiptPdf(makeReceipt())).rejects.toThrow(/Unable to load/)
    expect(save).not.toHaveBeenCalled()

    fetch.mockImplementation(async () => fontResponse([1]))
    await downloadReceiptPdf(makeReceipt())

    expect(save).toHaveBeenCalledTimes(1)
  })
})
