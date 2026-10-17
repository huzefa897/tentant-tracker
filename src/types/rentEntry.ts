export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid'

// A bill's own status, apart from its payments: a void bill is kept as history and counts
// towards nothing (it's never "paid" or "unpaid").
export type BillStatus = 'active' | 'void'

// When a property's rent is due: during the billing month (prepaid) or the next one (postpaid).
export type PaymentTiming = 'prepaid' | 'postpaid'

// Whether a bill's money is late, apart from how much is paid: a partially paid bill can also be
// overdue. From the backend, which compares the due date with today at the property.
export type DueStatus = 'settled' | 'overdue' | 'due_today' | 'upcoming'

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
  // True while the rent is still the tenant's rent the form started with. The request then leaves
  // it out and the backend charges the tenancy's current rent, so a rent changed meanwhile isn't
  // overridden by the old one.
  useTenancyRent?: boolean
}

// What the new-entry form submits: the bill, and optionally a payment received with it (saved
// together with the bill, or neither is).
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
  // The sum of the bill's payments.
  totalPaid: number
  // Zero for a void bill.
  outstanding: number
  // null for a void bill.
  status: PaymentStatus | null
  // Saved with the bill when it was created (the property's timing, the tenant's due day), so
  // later changes never move it. All three are null on a bill from before due dates; dueStatus
  // is also null on a void bill.
  paymentTiming: PaymentTiming | null
  dueDate: string | null // YYYY-MM-DD
  dueStatus: DueStatus | null
  notes: string
  createdAt: string // ISO timestamp
  billStatus: BillStatus
  // When, by whom and why it was voided; null while active.
  voided: { at: string; byName: string; reason: string } | null
  // A correction's two bills: the void bill a replacement replaces, and the replacement of a
  // corrected one.
  replacesEntryId: string | null
  replacedByEntryId: string | null
}

// A corrected bill's replacement charges, and why. The tenancy, month and electricity rate are
// the original bill's.
export interface EntryCorrectionInput {
  rentAmount: number
  electricityUnits: number
  waterAmount: number
  notes: string
  reason: string
}

// A correction as the backend made it: the original, now void, and its replacement.
export interface CorrectedEntry {
  original: RentEntry
  replacement: RentEntry
  // True when the backend had already made it (a retry after a lost response).
  replayed: boolean
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
  // Active bills unless asked otherwise.
  billStatus?: BillStatus | 'all'
  year?: string // YYYY
  billingMonth?: string // YYYY-MM
  paymentStatus?: PaymentStatus
  page?: number
}
