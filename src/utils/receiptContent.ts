// What a receipt says, worked out from Django's saved snapshot only: nothing here reads current
// tenant, issuer, bill or payment data, or recalculates a figure. The PDF (utils/receiptPdf.ts)
// only lays this out, section by section, in this order.

import type { PaymentReceipt } from '@/types/receipt'
import { formatAmount, formatINR, formatINRWithPaise } from '@/utils/currency'
import {
  formatDateValue,
  formatDateValueNumeric,
  formatMonthValue,
  formatOrdinal,
  formatTimestamp,
} from '@/utils/date'
import { formatReading, FROM_UNITS_REPORTED, NOT_CHARGED } from '@/utils/electricity'
import { toPaise } from '@/utils/money'
import { formatPhoneNumber } from '@/utils/phone'

export interface ReceiptField {
  label: string
  value: string
}

// One side of "Issued by" / "Received from": a name in bold, then its lines.
export interface ReceiptParty {
  heading: string
  name: string
  lines: string[]
}

export interface ReceiptChargeRow {
  description: string
  details: string // printed after the description, in brackets; '' for none
  amount: string
}

// total: the bold, shaded Total due row. strong: a bold value. The tone colours a balance
// still owed (never a zero one).
export interface ReceiptSummaryRow {
  label: string
  value: string
  style: 'row' | 'total' | 'strong'
  tone: 'default' | 'overdue' | 'previous'
}

// A meter bill's readings, as saved; null for typed units or electricity left off.
export interface ReceiptConsumption {
  fields: ReceiptField[] // opening, closing, units, rate
  note: string // when each reading was taken
}

export interface ReceiptContent {
  // Set when the payment was reversed: printed prominently, above everything it no longer
  // confirms. The rest of the receipt is the snapshot as issued.
  voided: { banner: string; details: string } | null
  fileName: string
  propertyName: string
  title: string
  subtitle: string
  receiptNumber: string
  status: string
  // Reference, receipt date, billing period, payment date.
  facts: ReceiptField[]
  issuedBy: ReceiptParty
  receivedFrom: ReceiptParty
  rental: ReceiptField[]
  charges: ReceiptChargeRow[]
  summary: ReceiptSummaryRow[]
  consumption: ReceiptConsumption | null
  // The payment's own notes, as written; null when it has none.
  notes: string | null
  // tick: a payment was received (false for a reversed one, which confirms nothing).
  outcome: { heading: string; message: string; tick: boolean }
  authorizedBy: string
}

const RETAIN = 'Please retain this receipt for your records.'

// Characters most file systems reject.
function toFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// Lines with nothing to show (an unset phone number, say) are left out.
function present(lines: (string | false | null | undefined)[]): string[] {
  return lines.filter((line): line is string => Boolean(line))
}

export const VOID_BANNER = 'VOID — Payment reversed'

// The charges table's electricity row, as saved: units × rate, or "Not charged" (never ₹0,
// which would read as paid). A meter bill's readings are in its consumption details.
function electricityRow(charges: PaymentReceipt['charges']): ReceiptChargeRow {
  if (charges.electricityMode === 'not_charged') {
    return { description: 'Electricity', details: 'Not charged on this bill', amount: NOT_CHARGED }
  }
  return {
    description: 'Electricity charge',
    details: `${formatReading(charges.electricityUnits)} Units × ${formatINRWithPaise(charges.electricityRate)} per unit`,
    amount: formatAmount(charges.electricityAmount),
  }
}

// A reading worked out from units reported, not read off the meter: it may not match the dial,
// so the receipt says so.
function readingValue(point: { reading: number; fromUnits?: boolean }): string {
  return point.fromUnits
    ? `${formatReading(point.reading)} (${FROM_UNITS_REPORTED})`
    : formatReading(point.reading)
}

function readingNote(which: 'Opening' | 'Closing', point: { fromUnits?: boolean }, day: string) {
  return point.fromUnits
    ? `${which} reading worked out from units reported: ${formatDateValue(day)}`
    : `${which} reading recorded: ${formatDateValue(day)}`
}

// A meter bill's opening and closing readings, units and rate. The opening reading has no date
// when it's where tracking started: that day isn't printed.
function consumption(charges: PaymentReceipt['charges']): ReceiptConsumption | null {
  const { openingReading: opening, closingReading: closing } = charges
  if (charges.electricityMode !== 'meter' || !opening || !closing) return null
  const units = formatReading(charges.electricityUnits)
  return {
    fields: [
      { label: 'Opening reading', value: readingValue(opening) },
      { label: 'Closing reading', value: readingValue(closing) },
      { label: 'Units consumed', value: `${units} ${units === '1' ? 'unit' : 'units'}` },
      { label: 'Rate per unit', value: formatINRWithPaise(charges.electricityRate) },
    ],
    note: [
      opening.readOn === null
        ? 'Opening reading: the starting reading'
        : readingNote('Opening', opening, opening.readOn),
      readingNote('Closing', closing, closing.readOn),
    ].join(' · '),
  }
}

// A balance still owed is coloured; a zero one isn't.
function owed(value: number, tone: ReceiptSummaryRow['tone']): ReceiptSummaryRow['tone'] {
  return value > 0 ? tone : 'default'
}

export function getReceiptContent(receipt: PaymentReceipt): ReceiptContent {
  const { issuer, tenant, charges } = receipt
  const isVoid = receipt.status === 'void'
  const paidInFull = !isVoid && receipt.outstanding <= 0
  // Only differs from this payment's amount when earlier payments went towards the same bill.
  const paidEarlier = toPaise(receipt.totalPaid) !== toPaise(receipt.paymentAmount)
  const month = formatMonthValue(receipt.billingMonth)
  const notCharged = charges.electricityMode === 'not_charged'

  const chargeRows: ReceiptChargeRow[] = [
    {
      description: 'Rent amount',
      details: 'Monthly Rent',
      amount: formatAmount(charges.rentAmount),
    },
    electricityRow(charges),
  ]
  if (charges.waterAmount > 0) {
    chargeRows.push({
      description: 'Water charge',
      details: 'Monthly Water',
      amount: formatAmount(charges.waterAmount),
    })
  }

  const row = (label: string, value: number): ReceiptSummaryRow => ({
    label,
    value: formatINRWithPaise(value),
    style: 'row',
    tone: 'default',
  })

  const summary: ReceiptSummaryRow[] = [
    row('Rent amount', charges.rentAmount),
    notCharged
      ? { label: 'Electricity charge', value: NOT_CHARGED, style: 'row', tone: 'default' }
      : row('Electricity charge', charges.electricityAmount),
    ...(charges.waterAmount > 0 ? [row('Water charge', charges.waterAmount)] : []),
    { ...row('Total due', receipt.totalDue), style: 'total' },
    row(paidEarlier ? 'Total paid to date' : 'Amount paid', receipt.totalPaid),
    ...(paidEarlier ? [row('This payment', receipt.paymentAmount)] : []),
    {
      ...row('Outstanding balance', receipt.outstanding),
      style: 'strong',
      tone: owed(receipt.outstanding, 'overdue'),
    },
    {
      ...row('Previous month overdue', receipt.previousMonthOutstanding),
      style: 'strong',
      tone: owed(receipt.previousMonthOutstanding, 'previous'),
    },
  ]

  return {
    voided: isVoid
      ? {
          banner: VOID_BANNER,
          details: [
            receipt.voidedAt && `Reversed ${formatTimestamp(receipt.voidedAt)}.`,
            `Reason: ${receipt.voidReason}`,
            'This receipt no longer confirms a payment.',
          ]
            .filter(Boolean)
            .join(' '),
        }
      : null,
    // The reference already reads like the owners' receipt names: "Mirza_Baig_102_Rent_September 2026".
    // A void copy says so in its name too, so it isn't mistaken for the valid one.
    fileName: `${toFileName(receipt.reference)}${isVoid ? ' (VOID)' : ''}.pdf`,
    propertyName: issuer.name,
    title: 'Payment Receipt',
    subtitle: 'Rental payment receipt',
    receiptNumber: receipt.reference,
    status: isVoid ? 'VOID' : paidInFull ? 'PAID' : 'PARTIALLY PAID',
    facts: [
      { label: 'Receipt reference', value: receipt.reference },
      { label: 'Receipt date', value: formatDateValueNumeric(receipt.issuedDate) },
      { label: 'Billing period', value: month },
      { label: 'Payment date', value: formatDateValueNumeric(receipt.paidDate) },
    ],
    issuedBy: {
      heading: 'Issued by',
      name: issuer.name,
      lines: present([
        issuer.address,
        issuer.contactNumber && formatPhoneNumber(issuer.contactNumber),
        issuer.receivedBy && `Received by: ${issuer.receivedBy}`,
      ]),
    },
    receivedFrom: {
      heading: 'Received from (tenant)',
      name: tenant.name,
      lines: present([
        `Flat ${tenant.flatNumber}`,
        tenant.mobileNumber && formatPhoneNumber(tenant.mobileNumber),
        `Security deposit: ${formatINR(tenant.depositAmount)}`,
      ]),
    },
    rental: [
      { label: 'Rent due day', value: formatOrdinal(receipt.rentDueDay) },
      { label: 'Billing month', value: month },
    ],
    charges: chargeRows,
    summary,
    consumption: consumption(charges),
    notes: receipt.paymentNotes.trim() ? receipt.paymentNotes : null,
    outcome: isVoid
      ? {
          heading: 'Payment reversed.',
          message: 'This payment was corrected after the receipt was issued. The receipt is void.',
          tick: false,
        }
      : paidInFull
        ? {
            heading: 'Payment received in full.',
            message: `Thank you for your payment. ${RETAIN}`,
            tick: true,
          }
        : {
            heading: 'Part payment received.',
            message: `${formatINRWithPaise(receipt.outstanding)} remains due for ${month}. ${RETAIN}`,
            tick: true,
          },
    authorizedBy: `Authorized by ${issuer.authorizedBy || issuer.name}`,
  }
}
