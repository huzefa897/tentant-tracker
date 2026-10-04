import { describe, expect, it } from 'vitest'

import { receiptFonts } from '@/test/receiptFonts'
import { makeReceipt } from '@/test/rentEntries'
import { getReceiptContent } from '@/utils/receiptContent'
import { renderReceiptPdf } from '@/utils/receiptPdf'

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

  it('titles the PDF with the receipt number', () => {
    expect(render().output()).toContain('Payment Receipt RCP-202-202609')
  })
})
