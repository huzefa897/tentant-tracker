import type { TenantStatus } from '@/types/tenant'
import type { PaymentTiming } from '@/types/rentEntry'

// The property's rental periods (services/dashboard.service.ts): counts of months, counted
// apart from tenants, and the amounts known from prepared bills. A month awaiting its bill is
// counted, never summed: its amount isn't known yet.
export interface DashboardSummary {
  asOfDate: string // YYYY-MM-DD, today at the property
  generatedAt: string // ISO timestamp
  overduePeriodCount: number
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
