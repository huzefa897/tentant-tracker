export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid'

// A new bill as the form submits it. The electricity rate is the tenant's current rate, used
// for the preview only: the backend copies the rate from the tenancy when it saves the bill.
export interface RentEntryInput {
  tenantId: string
  billingMonth: string // YYYY-MM
  rentAmount: number
  electricityUnits: number
  electricityRate: number
  waterAmount: number
  notes: string
}

// What the new-entry form submits: the bill, and optionally a payment received with it.
// Payments aren't on the backend yet (BE Phase 5), so the connected form sends null.
export interface NewRentEntrySubmission {
  entry: RentEntryInput
  initialPayment: {
    amount: number
    paidDate: string // YYYY-MM-DD
    notes: string
  } | null
}

// A saved bill, from the backend (services/rentEntry.service.ts). Rent and electricity rate are
// historical values copied when it was created, so a later change to the tenant's rent never
// changes it. The figures are Django's: screens display them rather than recalculating.
export interface RentEntry {
  id: string
  tenantId: string // the backend tenancy id
  billingMonth: string // YYYY-MM
  rentAmount: number
  electricityUnits: number
  electricityRate: number
  electricityAmount: number
  waterAmount: number
  totalDue: number
  // Always 0 until payments move to the backend (BE Phase 5).
  totalPaid: number
  outstanding: number
  status: PaymentStatus
  notes: string
  createdAt: string // ISO timestamp
}

// One page of a tenant's bills, newest billing month first.
export interface RentEntryPage {
  entries: RentEntry[]
  // Matches across all pages.
  count: number
  page: number
  hasNext: boolean
  hasPrevious: boolean
}

export interface RentEntryFilters {
  year?: string // YYYY
  billingMonth?: string // YYYY-MM
  page?: number
}
