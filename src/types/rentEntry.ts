export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid'

// What the user records for one tenant's bill for one month.
// Rent and electricity rate are copied onto the entry: they're historical values, so a
// later change to the tenant's rent must not change an old entry.
// Totals, outstanding amount and status are derived (utils/rentCalculations.ts), not stored.
export interface RentEntryInput {
  tenantId: string
  billingMonth: string // YYYY-MM
  rentAmount: number
  electricityUnits: number
  electricityRate: number
  waterAmount: number
  totalPaid: number
  paidDate: string | null // YYYY-MM-DD
  notes: string
}

export interface RentEntry extends RentEntryInput {
  id: string
  createdAt: string // ISO timestamp
}
