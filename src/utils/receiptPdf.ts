// Draws a receipt as a real-text A4 PDF (selectable, searchable), laid out like the owners'
// paper receipts. Content comes from utils/receiptContent.ts; this file only places it.
// Loaded on demand (utils/receiptDownload.ts): jsPDF is large.

import { jsPDF } from 'jspdf'

import type { ReceiptContent, ReceiptField } from '@/utils/receiptContent'

// TTF files as base64. The PDF standard fonts have no ₹, so Poppins (the app's font) is embedded.
export interface ReceiptFonts {
  regular: string
  bold: string
}

type Rgb = [number, number, number]

const INK: Rgb = [23, 23, 23]
const MUTED: Rgb = [82, 82, 82]
const FAINT: Rgb = [115, 115, 115]
const RULE: Rgb = [212, 212, 212]
const OVERDUE: Rgb = [185, 28, 28]
const PREVIOUS: Rgb = [180, 83, 9]

// Millimetres.
const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 10
const PAD = 6
const X = MARGIN + PAD
const W = PAGE_W - 2 * (MARGIN + PAD)
const BOTTOM = PAGE_H - MARGIN - PAD

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
  const lineHeight = (size: number) => size * 0.3528 * 1.35

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

  // Letter-spaced text; jsPDF's own centring ignores character spacing.
  function spaced(text: string, x: number, top: number, spacing: number, align: 'left' | 'center') {
    const width = doc.getTextWidth(text) + spacing * (text.length - 1)
    doc.text(text, align === 'center' ? x - width / 2 : x, top, { charSpace: spacing })
  }

  function rule(x1: number, top: number, x2: number, color: Rgb = RULE, width = 0.2) {
    doc.setDrawColor(...color)
    doc.setLineWidth(width)
    doc.line(x1, top, x2, top)
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

  // A row of equal boxes with a small spaced label over a bold value.
  function boxes(fields: ReceiptField[], tickFirstValue: number | null = null) {
    const gap = 5
    const boxW = (W - gap * (fields.length - 1)) / fields.length
    const valueSize = 10
    use('bold', valueSize)
    const lines = fields.map((field, index) =>
      doc.splitTextToSize(field.value, boxW - 8 - (index === tickFirstValue ? 5 : 0)),
    ) as string[][]
    const height = 7 + Math.max(...lines.map((l) => l.length)) * lineHeight(valueSize) + 1.5

    ensureSpace(height)
    fields.forEach((field, index) => {
      const left = X + index * (boxW + gap)
      doc.setDrawColor(...RULE)
      doc.setLineWidth(0.25)
      doc.rect(left, y, boxW, height)
      use('regular', 7, MUTED)
      spaced(field.label.toUpperCase(), left + 4, y + 4.5, 0.35, 'left')
      use('bold', valueSize)
      let textX = left + 4
      if (index === tickFirstValue) {
        tick(textX, y + 9.5, valueSize)
        textX += 5
      }
      doc.text(lines[index]!, textX, y + 9.5, { lineHeightFactor: 1.35 })
    })
    y += height
  }

  function heading(text: string, x: number, width: number | null) {
    use('bold', 8.5)
    spaced(text.toUpperCase(), x, y, 0.45, 'left')
    if (width !== null) rule(x, y + 1.8, x + width, INK, 0.5)
  }

  // "Label : value" rows in a column; returns the height used. The colon has its own column,
  // so wrapped values (a two-line address) stay aligned.
  function details(fields: ReceiptField[], x: number, width: number, top: number): number {
    const labelW = 35
    const colonW = 2.5
    const size = 8
    const lh = lineHeight(size)
    let rowTop = top
    for (const field of fields) {
      use('regular', size, MUTED)
      const labelLines = doc.splitTextToSize(field.label, labelW - 2) as string[]
      use('regular', size)
      const valueLines = field.value
        .split('\n')
        .flatMap((part) => doc.splitTextToSize(part, width - labelW - colonW)) as string[]
      const baseline = rowTop + lh * 0.75
      use('regular', size, MUTED)
      doc.text(labelLines, x, baseline, { lineHeightFactor: 1.35 })
      use('regular', size)
      doc.text(':', x + labelW, baseline)
      doc.text(valueLines, x + labelW + colonW, baseline, { lineHeightFactor: 1.35 })
      rowTop += Math.max(labelLines.length, valueLines.length) * lh + 1
    }
    return rowTop - top
  }

  // Header
  use('bold', 18)
  y += 5
  spaced(content.title, PAGE_W / 2, y, 1.5, 'center')
  use('regular', 8.5, MUTED)
  y += 5
  spaced(content.subtitle, PAGE_W / 2, y, 0.5, 'center')
  y += 3
  rule(X, y, X + W)
  y += 4

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
    doc.text(detailLines, PAGE_W / 2, y + 14, { align: 'center', lineHeightFactor: 1.35 })
    y += bannerH + 5
  }

  boxes(
    [
      { label: 'Receipt No.', value: content.receiptNumber },
      { label: 'Receipt Date', value: content.receiptDate },
      { label: 'Payment Status', value: content.status },
    ],
    content.paidInFull ? 2 : null,
  )
  y += 6

  // Issuer and tenant, side by side.
  const colGap = 10
  const colW = (W - colGap) / 2
  ensureSpace(40)
  heading('Property / Issuer Details', X, colW)
  heading('Tenant Details', X + colW + colGap, colW)
  const columnsTop = y + 3.5
  const used = Math.max(
    details(content.issuer, X, colW, columnsTop),
    details(content.tenant, X + colW + colGap, colW, columnsTop),
  )
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.25)
  doc.line(X + colW + colGap / 2, y - 3, X + colW + colGap / 2, columnsTop + used)
  y = columnsTop + used + 4

  ensureSpace(25)
  heading('Rental Details', X, null)
  y += 2.5
  boxes(content.rental)
  y += 5.5

  // Charges table
  const col = { index: X, description: X + 8, details: X + 62, amount: X + W }
  const rowH = 5.5
  ensureSpace(rowH * (content.charges.length + 1))
  use('regular', 8, FAINT)
  doc.text('#', col.index, y)
  doc.text('DESCRIPTION', col.description, y)
  doc.text('DETAILS', col.details, y)
  doc.text('AMOUNT (₹)', col.amount, y, { align: 'right' })
  y += 2.5
  content.charges.forEach((row, index) => {
    const baseline = y + 3.9
    use('regular', 9)
    doc.text(String(index + 1), col.index, baseline)
    doc.text(row.description, col.description, baseline)
    doc.text(row.amount, col.amount, baseline, { align: 'right' })
    use('regular', 9, MUTED)
    doc.text(row.details, col.details, baseline)
    y += rowH
    rule(X, y, X + W)
  })

  // Totals, right-aligned under the amounts.
  const tones: Record<string, Rgb> = { default: INK, overdue: OVERDUE, previous: PREVIOUS }
  content.totals.forEach((total, index) => {
    ensureSpace(rowH)
    const baseline = y + 4
    use('bold', 9, tones[total.tone])
    doc.text(total.label, X + W - 42, baseline, { align: 'right' })
    doc.text(total.value, X + W, baseline, { align: 'right' })
    y += rowH
    if (index === 0) rule(X, y, X + W)
  })
  y += 3

  // Summary: what happened, and the amount received.
  const summaryH = 20
  const leftW = W * 0.6
  ensureSpace(summaryH)
  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.25)
  doc.rect(X, y, W, summaryH)
  doc.line(X + leftW, y, X + leftW, y + summaryH)
  tick(X + 6, y + 8.5, 11)
  use('bold', 11)
  doc.text(content.summary.heading, X + 11.5, y + 8.5)
  use('regular', 8, MUTED)
  doc.text(doc.splitTextToSize(content.summary.message, leftW - 12) as string[], X + 6, y + 14, {
    lineHeightFactor: 1.35,
  })
  const amountCentre = X + leftW + (W - leftW) / 2
  use('regular', 8, MUTED)
  spaced(content.summary.amountLabel, amountCentre, y + 7, 0.45, 'center')
  use('bold', 17)
  doc.text(content.summary.amount, amountCentre, y + 15, { align: 'center' })
  y += summaryH + 5

  // Notes / remarks. Laid out line by line: notes can run past the page (500 characters of short
  // lines), so the box continues on the next page instead of cutting text off.
  use('regular', 8)
  const paragraphs = content.remarks.map((text) => doc.splitTextToSize(text, W - 10) as string[])
  const remarksLh = lineHeight(8)
  const boxPad = 3
  let boxTop = 0

  function closeRemarksBox() {
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.25)
    doc.rect(X, boxTop, W, y + boxPad - boxTop)
  }

  ensureSpace(2.5 + 2 * boxPad + remarksLh + 6)
  heading('Notes / Remarks', X, null)
  y += 2.5
  boxTop = y
  y += boxPad
  paragraphs.forEach((lines, index) => {
    if (index > 0) y += 2
    for (const line of lines) {
      if (y + remarksLh + boxPad > BOTTOM) {
        closeRemarksBox()
        newPage()
        boxTop = y
        y += boxPad
      }
      use('regular', 8)
      doc.text(line, X + 5, y + remarksLh * 0.75)
      y += remarksLh
    }
  })
  closeRemarksBox()
  y += boxPad + 11

  // Signatures and footer
  ensureSpace(16)
  const halfW = (W - 10) / 2
  rule(X, y, X + halfW, INK, 0.35)
  rule(X + halfW + 10, y, X + W, INK, 0.35)
  use('regular', 7, MUTED)
  spaced('SIGNATURE', X + halfW / 2, y + 4.5, 0.4, 'center')
  spaced(content.authorizedBy, X + halfW + 10 + halfW / 2, y + 4.5, 0.4, 'center')
  use('regular', 8.5)
  doc.text(content.footer, PAGE_W / 2, y + 10.5, { align: 'center' })
  y += 10.5 + PAD

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
