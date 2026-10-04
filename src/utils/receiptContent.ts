// What a receipt says, worked out from its saved snapshot only: nothing here reads current
// tenant, issuer, bill or payment data. The PDF (utils/receiptPdf.ts) only lays this out.

import type { PaymentReceipt } from '@/types/receipt'
import { formatAmount, formatINR, formatINRWithPaise } from '@/utils/currency'
import { formatDateValueNumeric, formatMonthValue, formatOrdinal } from '@/utils/date'
import { formatPhoneNumber } from '@/utils/phone'
import { calculateElectricity } from '@/utils/rentCalculations'

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

export function getReceiptContent(receipt: PaymentReceipt): ReceiptContent {
  const { issuer, tenant, charges } = receipt
  const paidInFull = receipt.outstanding <= 0
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
      amount: formatAmount(calculateElectricity(charges.electricityUnits, charges.electricityRate)),
    },
  ]

  if (charges.waterAmount > 0) {
    chargeRows.push({
      description: 'Water Charge',
      details: 'Monthly Water',
      amount: formatAmount(charges.waterAmount),
    })
  }

  return {
    // As the owners name their receipts: "Mirza Baig 102 Rent September 2026 …".
    fileName: `${toFileName(`${tenant.name} ${tenant.flatNumber} Rent ${month} ${receipt.reference}`)}.pdf`,
    title: 'PAYMENT RECEIPT',
    subtitle: 'Rental / Tenant Payment Receipt',
    receiptNumber: receipt.reference,
    receiptDate: formatDateValueNumeric(receipt.issuedDate),
    paidInFull,
    status: paidInFull ? 'PAID' : 'PARTIALLY PAID',
    issuer: present([
      { label: 'Received By / Property Manager', value: issuer.managerName },
      { label: 'Property / Building Name', value: issuer.name },
      { label: 'Address', value: issuer.address },
      {
        label: 'Contact Number',
        value: issuer.contactNumber && formatPhoneNumber(issuer.contactNumber),
      },
      { label: 'Email', value: issuer.email },
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
    summary: paidInFull
      ? {
          heading: 'Payment received in full.',
          message: 'Thank you! Your payment has been received successfully.',
          amountLabel: paidEarlier ? 'THIS PAYMENT' : 'AMOUNT PAID',
          amount: formatINRWithPaise(receipt.paymentAmount),
        }
      : {
          heading: 'Part payment received.',
          message: `${formatINRWithPaise(receipt.outstanding)} remains due for ${month}.`,
          amountLabel: paidEarlier ? 'THIS PAYMENT' : 'AMOUNT PAID',
          amount: formatINRWithPaise(receipt.paymentAmount),
        },
    remarks: receipt.paymentNotes.trim()
      ? [receipt.paymentNotes, STANDARD_REMARKS]
      : [STANDARD_REMARKS],
    authorizedBy: `AUTHORIZED BY · ${issuer.managerName || issuer.name}`,
    footer: 'Thank you for your payment.',
  }
}
