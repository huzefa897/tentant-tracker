import type { TenantStatus } from '@/types/tenant'

// Property-wide totals from recorded bills (services/dashboard.service.ts). Overdue, due today,
// due in the next 7 days and without a due date are parts of outstanding, never extra amounts.
export interface DashboardSummary {
  asOfDate: string // YYYY-MM-DD, today at the property
  generatedAt: string // ISO timestamp
  outstanding: number
  overdue: number
  dueToday: number
  dueNext7Days: number
  // Bills from before due dates: owed, but they can't be called late or on time.
  withoutDueDate: number
  pendingTenancyCount: number
  overdueTenancyCount: number
}

// Which pending tenancies to list: those with money in this window, or all of them.
export type DueFilter = 'all' | 'overdue' | 'due_today' | 'due_next_7_days'

// One tenancy that owes money (an ended one too).
export interface PendingTenancy {
  tenantId: string // the tenancy id
  name: string
  flatNumber: string
  tenancyStatus: TenantStatus
  outstanding: number
  overdue: number
  dueToday: number
  dueNext7Days: number
  withoutDueDate: number
  pendingBillCount: number
  oldestDueDate: string | null // YYYY-MM-DD
  oldestOverdueDate: string | null
}

export interface PendingTenancyPage {
  tenancies: PendingTenancy[]
  count: number // across all pages
  page: number
  hasNext: boolean
  hasPrevious: boolean
}

// A tenancy occupying the month with no active bill for it. Nothing is estimated for it.
export interface MissingBillTenancy {
  tenantId: string
  name: string
  flatNumber: string
  tenancyStatus: TenantStatus
  rentAmount: number
}

export interface MissingBills {
  billingMonth: string // YYYY-MM
  tenancies: MissingBillTenancy[]
}
