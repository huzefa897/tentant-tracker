import { beforeEach, describe, expect, it, vi } from 'vitest'

import { receiptFonts } from '@/test/receiptFonts'
import { makeReceipt } from '@/test/rentEntries'
import { getReceiptContent } from '@/utils/receiptContent'
import { renderReceiptPdf } from '@/utils/receiptPdf'

// Every piece of text drawn, with where it went: text in the PDF is stored as glyph ids, so the
// output can't simply be searched.
const drawn = vi.hoisted(() => [] as { text: string; y: number; page: number; size: number }[])
// The tick is drawn with lines, not text: a lines() call of two segments (jsPDF's own line() and
// rect() call it too, with one, three or more).
const ticks = vi.hoisted(() => ({ count: 0 }))

vi.mock('jspdf', async (importOriginal) => {
  const { jsPDF } = await importOriginal<typeof import('jspdf')>()

  class RecordingPdf extends jsPDF {
    constructor(...args: ConstructorParameters<typeof jsPDF>) {
      super(...args)
      const text = this.text.bind(this)
      this.text = ((value: string | string[], x: number, y: number, ...rest: unknown[]) => {
        for (const line of [value].flat()) {
          drawn.push({
            text: line,
            y,
            page: this.getCurrentPageInfo().pageNumber,
            size: this.getFontSize(),
          })
        }
        return (text as (...all: unknown[]) => RecordingPdf)(value, x, y, ...rest)
      }) as RecordingPdf['text']
      const lines = this.lines.bind(this)
      this.lines = ((...args: Parameters<typeof lines>) => {
        if (args[0].length === 2) ticks.count++
        return lines(...args)
      }) as RecordingPdf['lines']
    }
  }

  return { jsPDF: RecordingPdf }
})

beforeEach(() => {
  drawn.length = 0
  ticks.count = 0
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
        reference:
          'Mohammed_Abdul_Rahman_Siddiqui_Khan_Bahadur_Syed_Mustafa_Hussaini_Qadri_202_Rent_September 2026_12',
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
      {
        ...content,
        notes: Array.from({ length: 12 }, () => 'Line one\nLine two\nLine three').join('\n'),
      },
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
    // Then the outcome and who authorized it, on the last page.
    const last = drawn.filter((item) => item.page === doc.getNumberOfPages())
    expect(last.map((item) => item.text)).toEqual(
      expect.arrayContaining(['Part payment received.', 'Authorized by Test Manager']),
    )
  })

  it('prints each section of the receipt', () => {
    render()
    const texts = drawn.map((d) => d.text)

    expect(texts).toEqual(
      expect.arrayContaining([
        'Payment Receipt',
        'PARTIALLY PAID',
        'RECEIPT REFERENCE',
        'ISSUED BY',
        'RECEIVED FROM (TENANT)',
        'RENTAL DETAILS',
        'CHARGES',
        'PAYMENT SUMMARY',
        'Total due',
        'Outstanding balance',
      ]),
    )
  })

  it('prints the saved reference whole, doubled and leading underscores too', () => {
    // A name or flat made only of characters file names reject leaves an empty part.
    for (const reference of ['Mirza_Baig__Rent_May 2026', '_202_Rent_May 2026']) {
      drawn.length = 0
      render(makeReceipt({ reference }))
      expect(drawn.map((d) => d.text)).toContain(reference)
    }
  })

  it('keeps every character of a long reference that wraps', () => {
    const reference =
      'Mohammed_Abdul_Rahman_Siddiqui_Khan_Bahadur__Syed_Mustafa_Hussaini_Qadri_Rent_May 2026'
    render(makeReceipt({ reference }))
    const printed = drawn
      .map((d) => d.text)
      .filter(
        (text) => reference.replace(/ /g, '').includes(text.replace(/ /g, '')) && text.length > 3,
      )
    // Joined back (a wrap drops only the space it breaks at), it's the whole reference.
    expect(printed.join('').replace(/ /g, '')).toContain(reference.replace(/ /g, ''))
  })

  it('places a long issuer address and name whole, inside the page', () => {
    const base = makeReceipt()
    const doc = render(
      makeReceipt({
        issuer: {
          ...base.issuer,
          address: 'Opposite the old water tank, near the market road. '.repeat(10),
        },
        tenant: {
          ...base.tenant,
          name: 'Mohammed Abdul Rahman Siddiqui Khan Bahadur Syed '.repeat(2),
        },
      }),
    )
    expect(doc.getNumberOfPages()).toBe(1)
    expect(Math.max(...drawn.map((d) => d.y))).toBeLessThan(297 - 10)
  })

  it('prints "Not charged", and no consumption block, when electricity was left off', () => {
    const base = makeReceipt()
    render(
      makeReceipt({
        charges: {
          ...base.charges,
          electricityMode: 'not_charged',
          electricityUnits: 0,
          electricityAmount: 0,
        },
      }),
    )
    const texts = drawn.map((d) => d.text)

    // In the charges and in the summary.
    expect(texts.filter((text) => text === 'Not charged')).toHaveLength(2)
    expect(texts).toContain('(Not charged on this bill)')
    expect(texts).not.toContain('ELECTRICITY CONSUMPTION DETAILS')
  })

  it('ticks a payment received, and a reversed one gets no tick', () => {
    render()
    expect(ticks.count).toBe(1)

    ticks.count = 0
    render(
      makeReceipt({ status: 'void', voidedAt: '2026-10-07T08:00:00.000Z', voidReason: 'Wrong' }),
    )
    expect(ticks.count).toBe(0)
  })

  it('shrinks a very large reading to fit its cell', () => {
    const base = makeReceipt()
    const doc = render(
      makeReceipt({
        charges: {
          ...base.charges,
          electricityMode: 'meter',
          electricityUnits: 9999999.999,
          openingReading: { reading: 1, readOn: null },
          closingReading: { reading: 9999999.999, readOn: '2026-10-31' },
        },
      }),
    )
    const units = drawn.find((d) => d.text === '99,99,999.999 units')!
    expect(units.size).toBeLessThan(12)
    // Measured as it was drawn: inside its cell (a fourth of the 178 mm between the margins).
    doc.setFont('Poppins-bold', 'normal')
    doc.setFontSize(units.size)
    expect(doc.getTextWidth(units.text)).toBeLessThanOrEqual(178 / 4 - 6)
  })

  it('prints a meter bill’s consumption details, and none for typed units', () => {
    render()
    expect(drawn.map((d) => d.text)).not.toContain('ELECTRICITY CONSUMPTION DETAILS')

    drawn.length = 0
    const doc = render(
      makeReceipt({
        charges: {
          ...makeReceipt().charges,
          electricityMode: 'meter',
          electricityUnits: 29,
          electricityAmount: 174,
          openingReading: { reading: 250, readOn: null },
          closingReading: { reading: 279, readOn: '2026-11-07' },
        },
      }),
    )
    const texts = drawn.map((d) => d.text)

    expect(doc.getNumberOfPages()).toBe(1)
    expect(texts).toEqual(
      expect.arrayContaining(['ELECTRICITY CONSUMPTION DETAILS', '250', '279', '29 units']),
    )
  })

  it('prints a notes box only when the payment has notes', () => {
    render()
    expect(drawn.map((d) => d.text)).not.toContain('NOTES')

    drawn.length = 0
    render(makeReceipt({ paymentNotes: 'Paid in cash.' }))
    expect(drawn.map((d) => d.text)).toEqual(expect.arrayContaining(['NOTES', 'Paid in cash.']))
  })

  it('titles the PDF with the receipt number', () => {
    expect(render().output()).toContain('Payment Receipt Shaik_Zahid_Ali_202_Rent_September 2026')
  })

  it('prints VOID across a void receipt, still on one page', () => {
    const doc = render(
      makeReceipt({
        status: 'void',
        voidedAt: '2026-10-07T08:00:00.000Z',
        voidReason: 'Entered ₹10,000 instead of ₹1,000.',
      }),
    )
    const texts = drawn.map((d) => d.text)

    expect(doc.getNumberOfPages()).toBe(1)
    expect(texts).toContain('VOID — PAYMENT REVERSED')
    expect(texts.join(' ')).toContain('Reason: Entered ₹10,000 instead of ₹1,000.')
    expect(texts).toContain('VOID')
  })

  it('prints no VOID on a valid receipt', () => {
    render()

    expect(drawn.map((d) => d.text).filter((text) => text.includes('VOID'))).toEqual([])
  })
})
