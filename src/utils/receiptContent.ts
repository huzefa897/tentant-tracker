// What a receipt says, worked out from Django's saved snapshot only: nothing here reads current
// tenant, issuer, bill or payment data, or recalculates a figure. The PDF (utils/receiptPdf.ts)
// only lays this out.

import type { PaymentReceipt } from '@/types/receipt'
import { formatAmount, formatINR, formatINRWithPaise } from '@/utils/currency'
import {
  formatDateValueNumeric,
  formatMonthValue,
  formatOrdinal,
  formatTimestamp,
} from '@/utils/date'
import { formatPhoneNumber } from '@/utils/phone'

export interface ReceiptField {
  label: string
  value: string
}

export interface ReceiptChargeRow {
  description: string
  details: string
  amount: string
}

export interface ReceiptTotalRow {
  label: string
  value: string
  tone: 'default' | 'overdue' | 'previous'
}

export interface ReceiptContent {
  // Set when the payment was reversed: printed prominently, above everything it no longer
  // confirms. The rest of the receipt is the snapshot as issued.
  voided: { banner: string; details: string } | null
  fileName: string
  title: string
  subtitle: string
  receiptNumber: string
  receiptDate: string
  paidInFull: boolean
  status: string
  issuer: ReceiptField[]
  tenant: ReceiptField[]
  rental: ReceiptField[]
  charges: ReceiptChargeRow[]
  totals: ReceiptTotalRow[]
  summary: { heading: string; message: string; amountLabel: string; amount: string }
  // Paragraphs; the payment's own notes first, when there are any.
  remarks: string[]
  authorizedBy: string
  footer: string
}

const STANDARD_REMARKS = 'Thank you for your payment.\nPlease retain this receipt for your records.'

// Characters most file systems reject.
function toFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// Rows with nothing to show (an unset email, say) are left out.
function present(fields: ReceiptField[]): ReceiptField[] {
  return fields.filter((field) => field.value !== '')
}

export const VOID_BANNER = 'VOID — Payment reversed'

export function getReceiptContent(receipt: PaymentReceipt): ReceiptContent {
  const { issuer, tenant, charges } = receipt
  const isVoid = receipt.status === 'void'
  const paidInFull = !isVoid && receipt.outstanding <= 0
  // Only differs from this payment's amount when earlier payments went towards the same bill.
  const paidEarlier = receipt.totalPaid !== receipt.paymentAmount
  const month = formatMonthValue(receipt.billingMonth)

  const chargeRows: ReceiptChargeRow[] = [
    {
      description: 'Rent Amount',
      details: 'Monthly Rent',
      amount: formatAmount(charges.rentAmount),
    },
    {
      description: 'Electricity Units',
      details: 'Units Consumed',
      amount: String(charges.electricityUnits),
    },
    {
      description: 'Electricity Per Unit',
      details: 'Rate per Unit',
      amount: formatAmount(charges.electricityRate),
    },
    {
      description: 'Electricity Charge',
      details: `${charges.electricityUnits} Units × ${formatINR(charges.electricityRate)}`,
      amount: formatAmount(charges.electricityAmount),
    },
  ]

  if (charges.waterAmount > 0) {
    chargeRows.push({
      description: 'Water Charge',
      details: 'Monthly Water',
      amount: formatAmount(charges.waterAmount),
    })
  }

  const summaryAmount = {
    amountLabel: paidEarlier ? 'THIS PAYMENT' : 'AMOUNT PAID',
    amount: formatINRWithPaise(receipt.paymentAmount),
  }

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
    title: 'PAYMENT RECEIPT',
    subtitle: 'Rental / Tenant Payment Receipt',
    receiptNumber: receipt.reference,
    receiptDate: formatDateValueNumeric(receipt.issuedDate),
    paidInFull,
    status: isVoid ? 'VOID' : paidInFull ? 'PAID' : 'PARTIALLY PAID',
    issuer: present([
      { label: 'Received By', value: issuer.receivedBy },
      { label: 'Property / Building Name', value: issuer.name },
      { label: 'Address', value: issuer.address },
      {
        label: 'Contact Number',
        value: issuer.contactNumber && formatPhoneNumber(issuer.contactNumber),
      },
    ]),
    tenant: present([
      { label: 'Tenant Name', value: tenant.name },
      { label: 'Flat Number', value: tenant.flatNumber },
      {
        label: 'Tenant Mobile Number',
        value: tenant.mobileNumber && formatPhoneNumber(tenant.mobileNumber),
      },
      { label: 'Tenant Deposit Amount', value: formatINR(tenant.depositAmount) },
    ]),
    rental: [
      { label: 'Billing Month', value: month },
      { label: 'Rent Due Day', value: formatOrdinal(receipt.rentDueDay) },
      { label: 'Paid Date', value: formatDateValueNumeric(receipt.paidDate) },
    ],
    charges: chargeRows,
    totals: [
      { label: 'TOTAL DUE', value: formatAmount(receipt.totalDue), tone: 'default' },
      {
        label: paidEarlier ? 'TOTAL PAID TO DATE' : 'AMOUNT PAID',
        value: formatAmount(receipt.totalPaid),
        tone: 'default',
      },
      { label: 'OVERDUE AMOUNT', value: formatAmount(receipt.outstanding), tone: 'overdue' },
      {
        label: 'LAST MONTH OVERDUE',
        value: formatAmount(receipt.previousMonthOutstanding),
        tone: 'previous',
      },
    ],
    summary: isVoid
      ? {
          heading: 'Payment reversed.',
          message: 'This payment was corrected after the receipt was issued. The receipt is void.',
          ...summaryAmount,
        }
      : paidInFull
        ? {
            heading: 'Payment received in full.',
            message: 'Thank you! Your payment has been received successfully.',
            ...summaryAmount,
          }
        : {
            heading: 'Part payment received.',
            message: `${formatINRWithPaise(receipt.outstanding)} remains due for ${month}.`,
            ...summaryAmount,
          },
    remarks: receipt.paymentNotes.trim()
      ? [receipt.paymentNotes, STANDARD_REMARKS]
      : [STANDARD_REMARKS],
    authorizedBy: `AUTHORIZED BY · ${issuer.authorizedBy || issuer.name}`,
    footer: isVoid ? `${VOID_BANNER}.` : 'Thank you for your payment.',
  }
}
