import { beforeEach, describe, expect, it, vi } from 'vitest'

import { receiptFonts } from '@/test/receiptFonts'
import { makeReceipt } from '@/test/rentEntries'
import { getReceiptContent } from '@/utils/receiptContent'
import { renderReceiptPdf } from '@/utils/receiptPdf'

// Every piece of text drawn, with where it went: text in the PDF is stored as glyph ids, so the
// output can't simply be searched.
const drawn = vi.hoisted(() => [] as { text: string; y: number; page: number }[])

vi.mock('jspdf', async (importOriginal) => {
  const { jsPDF } = await importOriginal<typeof import('jspdf')>()

  class RecordingPdf extends jsPDF {
    constructor(...args: ConstructorParameters<typeof jsPDF>) {
      super(...args)
      const text = this.text.bind(this)
      this.text = ((value: string | string[], x: number, y: number, ...rest: unknown[]) => {
        for (const line of [value].flat()) {
          drawn.push({ text: line, y, page: this.getCurrentPageInfo().pageNumber })
        }
        return (text as (...all: unknown[]) => jsPDF)(value, x, y, ...rest)
      }) as jsPDF['text']
    }
  }

  return { jsPDF: RecordingPdf }
})

beforeEach(() => {
  drawn.length = 0
})

function render(receipt = makeReceipt()) {
  return renderReceiptPdf(getReceiptContent(receipt), receiptFonts)
}

describe('renderReceiptPdf', () => {
  it('produces an A4 PDF with the Poppins font embedded (for the ₹ sign)', () => {
    const doc = render()
    const output = doc.output()

    expect(output.startsWith('%PDF-')).toBe(true)
    expect(output).toContain('Poppins')
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0)
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0)
  })

  it('fits a typical receipt on one page', () => {
    expect(render().getNumberOfPages()).toBe(1)
  })

  it('fits a long reference, a long name and maximum-length notes on one page', () => {
    const doc = render(
      makeReceipt({
        reference: `RCP-202-202609-2-${'c'.repeat(36)}`,
        tenant: {
          ...makeReceipt().tenant,
          name: 'Mohammed Abdul Rahman Siddiqui Khan Bahadur Syed Mustafa Hussaini Qadri',
        },
        paymentAmount: 3000,
        totalPaid: 13000,
        outstanding: 2750,
        paymentNotes: 'Paid by bank transfer; reference UTR0012345678901234567890. '
          .repeat(9)
          .slice(0, 500),
      }),
    )

    expect(doc.getNumberOfPages()).toBe(1)
  })

  it('continues on a new page rather than cutting content off', () => {
    const content = getReceiptContent(makeReceipt())
    const doc = renderReceiptPdf(
      { ...content, remarks: Array.from({ length: 12 }, () => 'Line one\nLine two\nLine three') },
      receiptFonts,
    )

    expect(doc.getNumberOfPages()).toBe(2)
  })

  // 250 one-character lines (500 characters, the notes limit) run over several pages.
  it('draws every line of long notes inside a page', () => {
    const doc = render(makeReceipt({ paymentNotes: 'x\n'.repeat(250) }))
    const notes = drawn.filter((item) => item.text === 'x')

    expect(doc.getNumberOfPages()).toBeGreaterThan(2)
    expect(notes).toHaveLength(250)
    for (const { y } of notes) {
      expect(y).toBeGreaterThan(10)
      expect(y).toBeLessThan(297 - 10)
    }
    // Then the standard remarks, the signatures and the footer, on the last page.
    const last = drawn.filter((item) => item.page === doc.getNumberOfPages())
    expect(last.map((item) => item.text)).toEqual(
      expect.arrayContaining([
        'Please retain this receipt for your records.',
        'Thank you for your payment.',
      ]),
    )
  })

  it('titles the PDF with the receipt number', () => {
    expect(render().output()).toContain('Payment Receipt RCP-202-202609')
  })
})
