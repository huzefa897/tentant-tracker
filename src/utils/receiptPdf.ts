// Draws a receipt as a real-text A4 PDF (selectable, searchable). Content comes from
// utils/receiptContent.ts; this file only places it: a header with the status, the receipt's
// facts, who issued it and who paid, the rental details, the charges, the payment summary, a
// meter bill's consumption, the payment's notes, and the outcome with who authorized it.
// Loaded on demand (utils/receiptDownload.ts): jsPDF is large.

import { jsPDF } from 'jspdf'

import type {
  ReceiptContent,
  ReceiptField,
  ReceiptParty,
  ReceiptSummaryRow,
} from '@/utils/receiptContent'

// TTF files as base64. The PDF standard fonts have no ₹, so Poppins (the app's font) is embedded.
export interface ReceiptFonts {
  regular: string
  bold: string
}

type Rgb = [number, number, number]

const INK: Rgb = [23, 23, 23]
const MUTED: Rgb = [82, 82, 82]
const RULE: Rgb = [190, 190, 190]
const SHADE: Rgb = [236, 236, 236]
const OVERDUE: Rgb = [185, 28, 28]
const PREVIOUS: Rgb = [180, 83, 9]
const TONES: Record<ReceiptSummaryRow['tone'], Rgb> = {
  default: INK,
  overdue: OVERDUE,
  previous: PREVIOUS,
}

// Millimetres.
const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 10
const PAD = 6
const X = MARGIN + PAD
const W = PAGE_W - 2 * (MARGIN + PAD)
const BOTTOM = PAGE_H - MARGIN - PAD
// Space between sections.
const GAP = 3.5

type Face = 'regular' | 'bold'

export function renderReceiptPdf(content: ReceiptContent, fonts: ReceiptFonts): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  doc.setProperties({
    title: `Payment Receipt ${content.receiptNumber}`,
    subject: content.subtitle,
  })

  for (const [face, data] of Object.entries(fonts) as [Face, string][]) {
    doc.addFileToVFS(`Poppins-${face}.ttf`, data)
    doc.addFont(`Poppins-${face}.ttf`, `Poppins-${face}`, 'normal')
  }

  let y = MARGIN + PAD

  function use(face: Face, size: number, color: Rgb = INK) {
    doc.setFont(`Poppins-${face}`, 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
  }

  // Line height in mm for a font size in points.
  const lineHeight = (size: number) => size * 0.3528 * 1.3
  // Where a line's baseline sits below its top.
  const ascent = (size: number) => size * 0.3528 * 0.95

  // Each page gets its own frame, drawn once the page's content is known.
  const frames: { page: number; top: number; bottom: number }[] = []
  let frameTop = MARGIN

  function newPage() {
    frames.push({ page: doc.getNumberOfPages(), top: frameTop, bottom: PAGE_H - MARGIN })
    doc.addPage()
    frameTop = MARGIN
    y = MARGIN + PAD
  }

  function ensureSpace(height: number) {
    if (y + height > BOTTOM) newPage()
  }

  // Letter-spaced text; jsPDF's own alignment ignores character spacing.
  function spaced(
    text: string,
    x: number,
    baseline: number,
    spacing: number,
    align: 'left' | 'center' | 'right' = 'left',
  ) {
    const width = doc.getTextWidth(text) + spacing * (text.length - 1)
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x
    doc.text(text, left, baseline, { charSpace: spacing })
  }

  function line(x1: number, y1: number, x2: number, y2: number, color: Rgb = RULE, width = 0.25) {
    doc.setDrawColor(...color)
    doc.setLineWidth(width)
    doc.line(x1, y1, x2, y2)
  }

  function box(x: number, top: number, width: number, height: number, color: Rgb = RULE) {
    doc.setDrawColor(...color)
    doc.setLineWidth(0.3)
    doc.rect(x, top, width, height)
  }

  function shade(x: number, top: number, width: number, height: number) {
    doc.setFillColor(...SHADE)
    doc.rect(x, top, width, height, 'F')
  }

  function tick(x: number, baseline: number, size: number) {
    const s = size * 0.3528
    doc.setDrawColor(...INK)
    doc.setLineWidth(s * 0.14)
    doc.lines(
      [
        [s * 0.25, s * 0.28],
        [s * 0.45, -s * 0.62],
      ],
      x,
      baseline - s * 0.32,
    )
  }

  function wrap(text: string, width: number): string[] {
    return text.split('\n').flatMap((part) => doc.splitTextToSize(part, width) as string[])
  }

  // Wraps a receipt reference ("Shaik_Zahid_Ali_202_Rent_September 2026") after an underscore
  // or at a space, so its parts stay whole; a part too long for a line still wraps. Every
  // character is kept, doubled or leading underscores too: it's the saved reference, printed.
  function wrapReference(text: string, width: number): string[] {
    const parts = text.split(/(?<=[_ ])/)
    const lines: string[] = []
    let current = ''
    for (const part of parts) {
      if (current && doc.getTextWidth((current + part).trimEnd()) > width) {
        lines.push(current.trimEnd())
        current = ''
      }
      current += part
    }
    if (current) lines.push(current.trimEnd())
    return lines.flatMap((part) => wrap(part, width))
  }

  // A shaded section title across `width`.
  const BAR_H = 6.5
  function bar(title: string, x = X, width = W) {
    shade(x, y, width, BAR_H)
    use('bold', 9.5)
    spaced(title.toUpperCase(), x + 3, y + 4.6, 0.35)
    y += BAR_H
  }

  // Header: the property, the title and the status, then a heavy rule.
  const statusW = 46
  const statusLeft = X + W - statusW
  use('bold', 11)
  spaced(content.propertyName.toUpperCase(), X, y + 4, 0.6)
  use('bold', 20)
  doc.text(content.title, X, y + 12)
  use('regular', 10, MUTED)
  doc.text(content.subtitle, X, y + 17.5)
  line(statusLeft - 6, y, statusLeft - 6, y + 18.5, INK, 0.3)
  const statusSize = content.status.length > 6 ? 11 : 15
  doc.setDrawColor(...(content.voided ? OVERDUE : INK))
  doc.setLineWidth(0.6)
  doc.roundedRect(statusLeft, y + 2.75, statusW, 13, 2, 2)
  use('bold', statusSize, content.voided ? OVERDUE : INK)
  spaced(
    content.status,
    statusLeft + statusW / 2,
    y + 9.25 + statusSize * 0.3528 * 0.36,
    0.6,
    'center',
  )
  y += 20.5
  line(X, y, X + W, y, INK, 0.5)
  y += GAP

  // A void receipt says so before anything else, in red, across the page.
  if (content.voided) {
    use('regular', 8.5, OVERDUE)
    const detailLines = doc.splitTextToSize(content.voided.details, W - 12) as string[]
    const bannerH = 13 + detailLines.length * lineHeight(8.5)
    doc.setDrawColor(...OVERDUE)
    doc.setLineWidth(0.8)
    doc.rect(X, y, W, bannerH)
    use('bold', 16, OVERDUE)
    spaced(content.voided.banner.toUpperCase(), PAGE_W / 2, y + 8.5, 0.8, 'center')
    use('regular', 8.5, OVERDUE)
    doc.text(detailLines, PAGE_W / 2, y + 14, { align: 'center', lineHeightFactor: 1.3 })
    y += bannerH + GAP
  }

  // The receipt's facts: one bordered row of cells, a small label over a bold value.
  function facts(fields: ReceiptField[]) {
    // Written for the four facts the receipt has (reference, receipt date, billing period,
    // payment date): a fifth would share the rest equally, so give it a share here.
    const shares = [0.36, 0.19, 0.22, 0.23]
    const widths = fields.map((_, i) => W * (shares[i] ?? 1 / fields.length))
    use('bold', 9)
    // The first is the reference.
    const values = fields.map((field, i) =>
      i === 0 ? wrapReference(field.value, widths[i]! - 6) : wrap(field.value, widths[i]! - 6),
    )
    const height = 8.5 + Math.max(...values.map((v) => v.length)) * lineHeight(9) + 1
    ensureSpace(height)
    box(X, y, W, height)
    let left = X
    fields.forEach((field, i) => {
      if (i > 0) line(left, y, left, y + height)
      use('regular', 6.8, MUTED)
      spaced(field.label.toUpperCase(), left + 3, y + 5, 0.35)
      use('bold', 9)
      doc.text(values[i]!, left + 3, y + 9.5, { lineHeightFactor: 1.3 })
      left += widths[i]!
    })
    y += height + GAP
  }
  facts(content.facts)

  // Issued by and received from, side by side. Wrapped first, so the section's height is known
  // before it is placed.
  function layoutParty(p: ReceiptParty, width: number) {
    use('bold', 10.5)
    const name = wrap(p.name, width - 6)
    use('regular', 8.5)
    const lines = p.lines.map((text) => wrap(text, width - 6))
    const height =
      name.length * lineHeight(10.5) +
      0.5 +
      lines.reduce((sum, wrapped) => sum + wrapped.length * lineHeight(8.5), 0)
    return { name, lines, height }
  }
  function drawParty(layout: ReturnType<typeof layoutParty>, x: number, top: number) {
    let at = top
    use('bold', 10.5)
    doc.text(layout.name, x + 3, at + ascent(10.5), { lineHeightFactor: 1.3 })
    at += layout.name.length * lineHeight(10.5) + 0.5
    use('regular', 8.5)
    for (const lines of layout.lines) {
      doc.text(lines, x + 3, at + ascent(8.5), { lineHeightFactor: 1.3 })
      at += lines.length * lineHeight(8.5)
    }
  }
  {
    const colGap = 8
    const colW = (W - colGap) / 2
    const right = X + colW + colGap
    const issuedBy = layoutParty(content.issuedBy, colW)
    const receivedFrom = layoutParty(content.receivedFrom, colW)
    const used = Math.max(issuedBy.height, receivedFrom.height)
    ensureSpace(BAR_H + 2.5 + used)
    const top = y
    bar(content.issuedBy.heading, X, colW)
    y = top
    bar(content.receivedFrom.heading, right, colW)
    drawParty(issuedBy, X, y + 2.5)
    drawParty(receivedFrom, right, y + 2.5)
    line(X + colW + colGap / 2, top + BAR_H + 1, X + colW + colGap / 2, y + 2.5 + used)
    y += 2.5 + used + GAP
  }

  // Rental details: "Label: value" pairs across one line.
  ensureSpace(BAR_H + 10)
  line(X, y, X + W, y, INK, 0.3)
  y += 1.5
  bar('Rental details')
  {
    const half = W / 2
    const baseline = y + 5.6
    content.rental.forEach((field, i) => {
      const left = X + 3 + i * half
      use('regular', 9.5)
      const label = `${field.label}:`
      doc.text(label, left, baseline)
      const after = left + doc.getTextWidth(label) + 1.8
      use('bold', 10)
      doc.text(field.value, after, baseline)
      if (i > 0) line(X + i * half, y + 1.5, X + i * half, y + 7.5)
    })
    y += 9
  }
  line(X, y, X + W, y, INK, 0.3)
  y += GAP

  // Charges: # · description (details) · amount.
  {
    const rowH = 5.8
    ensureSpace(BAR_H + rowH * (content.charges.length + 1))
    bar('Charges')
    const col = { index: X + 3, description: X + 14, amount: X + W - 3 }
    use('regular', 7.5, MUTED)
    spaced('#', col.index, y + 4.1, 0.35)
    spaced('DESCRIPTION', col.description, y + 4.1, 0.35)
    spaced('AMOUNT (₹)', col.amount, y + 4.1, 0.35, 'right')
    y += rowH
    line(X, y, X + W, y)
    content.charges.forEach((row, index) => {
      const baseline = y + 4.1
      use('regular', 9.5)
      doc.text(String(index + 1), col.index, baseline)
      doc.text(row.description, col.description, baseline)
      if (row.details) {
        const after = col.description + doc.getTextWidth(row.description) + 1.2
        use('regular', 8.5, MUTED)
        doc.text(`(${row.details})`, after, baseline)
      }
      use('regular', 9.5)
      doc.text(row.amount, col.amount, baseline, { align: 'right' })
      y += rowH
      line(X, y, X + W, y)
    })
    y += GAP
  }

  // Payment summary: a bordered box, Total due shaded and large.
  {
    const rowH = 5.4
    const totalH = 8.5
    const height =
      BAR_H + content.summary.reduce((sum, row) => sum + (row.style === 'total' ? totalH : rowH), 0)
    ensureSpace(height)
    const top = y
    bar('Payment summary')
    line(X, y, X + W, y, INK, 0.3)
    content.summary.forEach((row, index) => {
      const h = row.style === 'total' ? totalH : rowH
      if (row.style === 'total') {
        shade(X, y, W, h)
        use('bold', 13)
        doc.text(row.label, X + 4, y + 6)
        doc.text(row.value, X + W - 4, y + 6, { align: 'right' })
      } else {
        use('regular', 9.5)
        doc.text(row.label, X + 4, y + 4.1)
        use(row.style === 'strong' ? 'bold' : 'regular', 9.5, TONES[row.tone])
        doc.text(row.value, X + W - 4, y + 4.1, { align: 'right' })
      }
      y += h
      if (index < content.summary.length - 1) {
        const heavy = row.style === 'total' || content.summary[index + 1]?.style === 'total'
        line(X, y, X + W, y, heavy ? INK : RULE, heavy ? 0.3 : 0.2)
      }
    })
    box(X, top, W, y - top, INK)
    y += GAP
  }

  // A meter bill's readings: four cells, then when they were taken.
  if (content.consumption) {
    const { fields, note } = content.consumption
    const headH = 6
    const valueH = 8.5
    const noteH = 6.5
    ensureSpace(BAR_H + 2 + headH + valueH + noteH)
    bar('Electricity consumption details')
    y += 2
    const top = y
    const cellW = W / fields.length
    shade(X, y, W, headH)
    fields.forEach((field, i) => {
      const centre = X + cellW * i + cellW / 2
      use('bold', 7, MUTED)
      spaced(field.label.toUpperCase(), centre, y + 4, 0.35, 'center')
      // 12 pt, smaller when a value (a very large reading) wouldn't fit its cell.
      let size = 12
      use('bold', size)
      while (size > 6 && doc.getTextWidth(field.value) > cellW - 6) {
        size -= 0.5
        use('bold', size)
      }
      doc.text(field.value, centre, y + headH + 6, { align: 'center' })
      if (i > 0) line(X + cellW * i, top, X + cellW * i, top + headH + valueH, INK, 0.3)
    })
    y += headH + valueH
    line(X, y, X + W, y, INK, 0.3)
    use('regular', 8.5, MUTED)
    doc.text(note, X + 4, y + 4.4)
    y += noteH
    box(X, top, W, y - top, INK)
    y += GAP
  }

  // The payment's notes. Laid out line by line: notes can run past the page (500 characters
  // of short lines), so the box continues on the next page instead of cutting text off.
  if (content.notes !== null) {
    use('regular', 8)
    const lines = wrap(content.notes, W - 8)
    const lh = lineHeight(8)
    const boxPad = 2.5
    let boxTop = 0
    const closeBox = () => box(X, boxTop, W, y + boxPad - boxTop)

    ensureSpace(BAR_H + 2 * boxPad + lh)
    bar('Notes')
    boxTop = y
    y += boxPad
    for (const text of lines) {
      if (y + lh + boxPad > BOTTOM) {
        closeBox()
        newPage()
        boxTop = y
        y += boxPad
      }
      use('regular', 8)
      doc.text(text, X + 4, y + lh * 0.75)
      y += lh
    }
    closeBox()
    y += boxPad + GAP
  }

  // The outcome, and who authorized the receipt.
  {
    const rightW = 58
    const leftW = W - rightW
    // A reversed payment gets no tick: nothing was received.
    const indent = content.outcome.tick ? 7 : 1
    use('regular', 8.5, MUTED)
    const message = doc.splitTextToSize(content.outcome.message, leftW - indent - 4) as string[]
    const height = 10 + message.length * lineHeight(8.5) + 1
    ensureSpace(height + 2)
    line(X, y, X + W, y, INK, 0.4)
    y += 2
    if (content.outcome.tick) tick(X + 1, y + 6.5, 12)
    use('bold', 12)
    doc.text(content.outcome.heading, X + indent, y + 6.5)
    use('regular', 8.5, MUTED)
    doc.text(message, X + indent, y + 11.5, { lineHeightFactor: 1.3 })
    line(X + leftW, y + 1, X + leftW, y + height - 1, INK, 0.3)
    use('bold', 9)
    const signer = doc.splitTextToSize(content.authorizedBy, rightW - 6) as string[]
    const signerTop = y + height / 2 + 1 - ((signer.length - 1) * lineHeight(9)) / 2
    doc.text(signer, X + leftW + rightW / 2, signerTop, {
      align: 'center',
      lineHeightFactor: 1.3,
    })
    y += height + PAD
  }

  frames.push({ page: doc.getNumberOfPages(), top: frameTop, bottom: y })
  for (const frame of frames) {
    doc.setPage(frame.page)
    // Every page of a void receipt carries it, faint, behind nothing it hides.
    if (content.voided) {
      doc.saveGraphicsState()
      doc.setGState(doc.GState({ opacity: 0.12 }))
      use('bold', 110, OVERDUE)
      doc.text('VOID', PAGE_W / 2, PAGE_H / 2 + 20, { align: 'center', angle: 35 })
      doc.restoreGraphicsState()
    }
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.6)
    doc.rect(MARGIN, frame.top, PAGE_W - 2 * MARGIN, frame.bottom - frame.top)
  }

  return doc
}
