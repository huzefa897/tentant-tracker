// Who issues receipts (config/receiptIssuer.ts).
export interface ReceiptIssuer {
  name: string // property / building
  managerName: string // received by; '' to leave it off
  address: string
  contactNumber: string // E.164, or '' for none
  email: string // '' for none
}

// Confirms one Payment. A snapshot taken when it's issued, so later payments, or changes to the
// tenant or issuer details, never change it: reprints use it exactly as saved.
// The bill figures are as they stood right after this payment (payments recorded before it,
// plus this one), so they're the same whenever the receipt is issued.
export interface PaymentReceipt {
  id: string
  reference: string // shown on the receipt; never regenerated
  paymentId: string
  entryId: string
  issuedAt: string // ISO timestamp

  issuer: ReceiptIssuer

  tenant: {
    name: string
    flatNumber: string
    mobileNumber: string // E.164, or '' if unknown
    depositAmount: number
  }

  billingMonth: string // YYYY-MM
  rentDueDay: number // 1-31

  // The bill's charges, copied from the entry.
  charges: {
    rentAmount: number
    electricityUnits: number
    electricityRate: number
    waterAmount: number
  }
  totalDue: number
  totalPaid: number // paid towards this bill up to and including this payment
  outstanding: number // left on this bill after this payment
  // What the tenant's previous month's bill still owed when this receipt was issued (0 if none).
  // Shown for information only: it's never added to this bill.
  previousMonthOutstanding: number

  paymentAmount: number
  paidDate: string // YYYY-MM-DD
  paymentNotes: string
}
