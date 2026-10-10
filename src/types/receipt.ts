// Who issued a receipt, copied from the property (and the person issuing it) when it was issued.
export interface ReceiptIssuer {
  name: string // property / building
  address: string
  contactNumber: string // E.164, or '' for none
  receivedBy: string // the person who issued it; '' when they have no name
}

// issued: confirms its payment. void: the payment was reversed, so it confirms nothing; its
// reference and snapshot are kept as issued.
export type ReceiptStatus = 'issued' | 'void'

// Confirms one Payment. A snapshot Django saved when it was issued, so later payments, or
// changes to the tenant or property, never change it: every download uses it exactly as saved.
// The bill figures are as they stood right after this payment (payments recorded before it,
// plus this one), leaving out earlier payments already reversed when it was issued.
export interface PaymentReceipt {
  id: string
  reference: string // e.g. Shaik_Zahid_Ali_202_Rent_October 2026 (_2, _3… for a bill's later receipts); never regenerated
  paymentId: string
  entryId: string
  issuedAt: string // ISO timestamp
  // The date printed on the receipt: the property's date when it was issued. Saved rather than
  // worked out from issuedAt, which would depend on the time zone of whoever downloads it.
  issuedDate: string // YYYY-MM-DD

  issuer: ReceiptIssuer

  tenant: {
    name: string
    flatNumber: string
    mobileNumber: string // E.164, or '' if unknown
    depositAmount: number
  }

  billingMonth: string // YYYY-MM
  rentDueDay: number // 1-31

  // The bill's charges and electricity amount, as Django calculated them.
  charges: {
    rentAmount: number
    electricityUnits: number
    electricityRate: number
    electricityAmount: number
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

  // Not part of the snapshot: set once if the payment is reversed.
  status: ReceiptStatus
  voidedAt: string | null // ISO timestamp
  voidReason: string // '' while issued
}

// What a payment says about its receipt: enough to offer "Download receipt" rather than
// "Issue receipt", and to say it's void.
export interface ReceiptSummary {
  id: string
  reference: string
  status: ReceiptStatus
}

// What issuing returns. created: false when the payment already had this receipt (a repeat or
// a retry after a lost response): nothing new was issued.
export interface IssuedReceipt {
  receipt: PaymentReceipt
  created: boolean
}
