import type { TenantStatus } from '@/types/tenant'
import type { PaymentTiming } from '@/types/rentEntry'

// The property's rental periods (services/dashboard.service.ts): counts of months, counted
// apart from tenants, and the amounts known from prepared bills. A month awaiting its bill is
// counted, never summed: its amount isn't known yet.
export interface DashboardSummary {
  asOfDate: string // YYYY-MM-DD, today at the property
  generatedAt: string // ISO timestamp
  owedPeriodCount: number // every month still owed, due or not yet
  overduePeriodCount: number
  // How many days the oldest overdue month is past its due date; null when none is overdue.
  oldestOverdueDays: number | null
  overdueTenancyCount: number
  dueTodayPeriodCount: number
  upcomingPeriodCount: number
  awaitingBillPeriodCount: number
  overdueAwaitingBillPeriodCount: number
  owingTenancyCount: number
  knownOutstanding: number
  knownOverdue: number
  knownDueToday: number
  knownUpcoming: number
}

// Which months the list shows, by when they're due: due (overdue or due today, the default),
// one of those, the next 7 days, or every month still owed.
export type TimingFilter = 'due' | 'overdue' | 'due_today' | 'upcoming' | 'all'
export type PreparationFilter = 'all' | 'prepared' | 'not_prepared'

export type PeriodTiming = 'overdue' | 'due_today' | 'upcoming'
export type BillPreparation = 'prepared' | 'not_prepared'
// unknown: no bill yet, so no amount to settle.
export type Settlement = 'unknown' | 'unpaid' | 'partially_paid' | 'paid'
// Only those the viewer's role allows (mark_not_owed is the owners').
export type PeriodAction = 'prepare_bill' | 'mark_not_owed' | 'view_bill' | 'record_payment'

// One tenancy's month of rent that's still owed, its bill prepared or not.
export interface RentalPeriodRow {
  id: string
  tenantId: string // the tenancy id
  name: string
  flatNumber: string
  tenancyStatus: TenantStatus
  periodMonth: string // YYYY-MM
  paymentTiming: PaymentTiming
  dueDate: string // YYYY-MM-DD
  timing: PeriodTiming
  daysOverdue: number
  preparation: BillPreparation
  billId: string | null
  settlement: Settlement
  // null until the bill is prepared: never a zero standing in for an unknown amount.
  totalDue: number | null
  outstanding: number | null
  actions: PeriodAction[]
}

export interface RentalPeriodPage {
  periods: RentalPeriodRow[]
  count: number // across all pages
  page: number
  hasNext: boolean
  hasPrevious: boolean
}

export interface PeriodFilters {
  timing: TimingFilter
  preparation: PreparationFilter
  month: string | null // YYYY-MM, or every month
}

// Overdue bills (services/dashboard.service.ts getOverdueBills): active bills past their due
// date with money still to pay, across the user's properties, grouped by tenancy. Only bills:
// a month without one is on the rent-due list, never counted as paid.
export interface OverdueBill {
  id: string
  billingMonth: string // YYYY-MM
  dueDate: string // YYYY-MM-DD
  daysOverdue: number
  totalAmount: number
  paidAmount: number // payments not reversed
  outstanding: number
}

export interface OverdueTenant {
  tenantId: string // the tenancy id
  name: string
  flatNumber: string
  tenancyStatus: TenantStatus
  propertyId: string
  propertyName: string
  overdueBillCount: number
  outstanding: number
  oldestDueDate: string // YYYY-MM-DD
  bills: OverdueBill[] // oldest due first
}

export interface OverdueBills {
  asOfDate: string // YYYY-MM-DD, today at the property
  generatedAt: string
  tenantCount: number
  billCount: number
  totalOutstanding: number
  tenants: OverdueTenant[] // the oldest overdue bill first
}

export interface OverdueFilters {
  propertyId: string | null // every property
  month: string | null // YYYY-MM, or every month
  search: string // a tenant name or flat
}
