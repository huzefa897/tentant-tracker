export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid'

// The charges for one tenant's bill for one month. Money received is a separate Payment
// (types/payment.ts), so several payments against one bill each stay on record.
// Rent and electricity rate are copied onto the entry: they're historical values, so a
// later change to the tenant's rent must not change an old entry.
// Totals, amount paid, outstanding amount and status are derived (utils/rentCalculations.ts),
// not stored.
export interface RentEntryInput {
  tenantId: string
  billingMonth: string // YYYY-MM
  rentAmount: number
  electricityUnits: number
  electricityRate: number
  waterAmount: number
  notes: string
}

export interface RentEntry extends RentEntryInput {
  id: string
  createdAt: string // ISO timestamp
}

// What the new-entry form saves: the bill, and optionally a payment received with it.
export interface NewRentEntrySubmission {
  entry: RentEntryInput
  initialPayment: {
    amount: number
    paidDate: string // YYYY-MM-DD
    notes: string
  } | null
}
