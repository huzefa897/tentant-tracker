import { vi } from 'vitest'

import type {
  DashboardSummary,
  OverdueBill,
  OverdueBills,
  OverdueFilters,
  OverdueTenant,
  PeriodFilters,
  RentalPeriodPage,
  RentalPeriodRow,
} from '@/types/dashboard'

// A fake dashboardService, mocked for every test in src/test/setup.ts (the dashboard is where
// sign-in lands, so no test may reach the API through it). It filters and pages
// fakeDashboard.periods like the API; the summary is what tests set. getOverdueBills filters
// and totals fakeDashboard.overdueTenants. markNotOwed removes the
// month, as the backend's list would. Fictional people; the ids are the tenant fake's
// (tenant-001…).

// Shaik Zahid Ali's September, prepared and part paid, overdue 4 days on 15 October.
export function makePeriod(overrides: Partial<RentalPeriodRow> = {}): RentalPeriodRow {
  return {
    id: 'period-001',
    tenantId: 'tenant-001',
    name: 'Shaik Zahid Ali',
    flatNumber: '202',
    tenancyStatus: 'current',
    periodMonth: '2026-09',
    paymentTiming: 'postpaid',
    dueDate: '2026-10-11',
    timing: 'overdue',
    daysOverdue: 4,
    preparation: 'prepared',
    billId: 'entry-001',
    settlement: 'partially_paid',
    totalDue: 15750,
    outstanding: 5750,
    actions: ['view_bill', 'record_payment'],
    ...overrides,
  }
}

// A month whose bill isn't prepared: due, with no amount.
export function makeUnbilledPeriod(overrides: Partial<RentalPeriodRow> = {}): RentalPeriodRow {
  return makePeriod({
    id: 'period-002',
    tenantId: 'tenant-002',
    name: 'Mohammed Yusuf',
    flatNumber: '301',
    periodMonth: '2026-08',
    dueDate: '2026-09-20',
    daysOverdue: 25,
    preparation: 'not_prepared',
    billId: null,
    settlement: 'unknown',
    totalDue: null,
    outstanding: null,
    actions: ['prepare_bill'],
    ...overrides,
  })
}

export function makeSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    asOfDate: '2026-10-15',
    generatedAt: '2026-10-15T06:30:00Z',
    overduePeriodCount: 2,
    overdueTenancyCount: 2,
    dueTodayPeriodCount: 0,
    upcomingPeriodCount: 1,
    awaitingBillPeriodCount: 2,
    overdueAwaitingBillPeriodCount: 1,
    owingTenancyCount: 2,
    knownOutstanding: 5750,
    knownOverdue: 5750,
    knownDueToday: 0,
    knownUpcoming: 0,
    ...overrides,
  }
}

// Shaik Zahid Ali's September bill, part paid: ₹5,750 left, overdue 4 days on 15 October.
export function makeOverdueBill(overrides: Partial<OverdueBill> = {}): OverdueBill {
  return {
    id: 'entry-001',
    billingMonth: '2026-09',
    dueDate: '2026-10-11',
    daysOverdue: 4,
    totalAmount: 15750,
    paidAmount: 10000,
    outstanding: 5750,
    ...overrides,
  }
}

// A tenant with these bills (oldest due first); the count, total and oldest date follow them.
export function makeOverdueTenant(
  overrides: Partial<
    Omit<OverdueTenant, 'overdueBillCount' | 'outstanding' | 'oldestDueDate'>
  > = {},
): OverdueTenant {
  const bills = overrides.bills ?? [makeOverdueBill()]
  return {
    tenantId: 'tenant-001',
    name: 'Shaik Zahid Ali',
    flatNumber: '202',
    tenancyStatus: 'current',
    propertyId: '6f1c2a4e-0000-4000-8000-000000000001',
    propertyName: 'Test Towers',
    ...overrides,
    bills,
    overdueBillCount: bills.length,
    outstanding: bills.reduce((sum, bill) => sum + bill.outstanding, 0),
    oldestDueDate: bills[0]!.dueDate,
  }
}

// Mohammed Yusuf owes August and September in full; then Shaik Zahid Ali's September.
function defaultOverdueTenants(): OverdueTenant[] {
  return [
    makeOverdueTenant({
      tenantId: 'tenant-002',
      name: 'Mohammed Yusuf',
      flatNumber: '301',
      bills: [
        makeOverdueBill({
          id: 'entry-002',
          billingMonth: '2026-08',
          dueDate: '2026-09-10',
          daysOverdue: 35,
          paidAmount: 0,
          outstanding: 15750,
        }),
        makeOverdueBill({
          id: 'entry-003',
          billingMonth: '2026-09',
          dueDate: '2026-10-10',
          daysOverdue: 5,
          paidAmount: 0,
          outstanding: 15750,
        }),
      ],
    }),
    makeOverdueTenant(),
  ]
}

function defaults() {
  return {
    summary: makeSummary(),
    // Oldest due first, as the API orders them.
    periods: [
      makeUnbilledPeriod(),
      makePeriod(),
      makeUnbilledPeriod({
        id: 'period-003',
        periodMonth: '2026-09',
        dueDate: '2026-10-20',
        timing: 'upcoming',
        daysOverdue: 0,
      }),
    ],
    pageSize: 20,
    overdueTenants: defaultOverdueTenants(),
    overdueAsOf: '2026-10-15',
  }
}

export const fakeDashboard = defaults()

const DUE: Record<PeriodFilters['timing'], RentalPeriodRow['timing'][]> = {
  due: ['overdue', 'due_today'],
  overdue: ['overdue'],
  due_today: ['due_today'],
  upcoming: ['upcoming'],
  all: ['overdue', 'due_today', 'upcoming'],
}

export function periodPage(
  filters: PeriodFilters = { timing: 'due', preparation: 'all', month: null },
  page = 1,
): RentalPeriodPage {
  const matches = fakeDashboard.periods.filter(
    (period) =>
      DUE[filters.timing].includes(period.timing) &&
      (filters.preparation === 'all' || period.preparation === filters.preparation) &&
      (!filters.month || period.periodMonth === filters.month),
  )
  const start = (page - 1) * fakeDashboard.pageSize
  return {
    periods: matches.slice(start, start + fakeDashboard.pageSize),
    count: matches.length,
    page,
    hasNext: start + fakeDashboard.pageSize < matches.length,
    hasPrevious: page > 1,
  }
}

// The overdue list for these filters, as the API filters and totals it.
export function overdueBills(
  filters: OverdueFilters = { propertyId: null, month: null, search: '' },
): OverdueBills {
  const search = filters.search
    .trim()
    .toLowerCase()
    .replace(/^flat\s+/, '')
  const tenants = fakeDashboard.overdueTenants
    .filter((tenant) => !filters.propertyId || tenant.propertyId === filters.propertyId)
    .filter(
      (tenant) =>
        !search ||
        tenant.name.toLowerCase().includes(search) ||
        tenant.flatNumber.toLowerCase().includes(search),
    )
    .map((tenant) => ({
      tenant,
      bills: tenant.bills.filter((bill) => !filters.month || bill.billingMonth === filters.month),
    }))
    .filter(({ bills }) => bills.length > 0)
    .map(({ tenant, bills }) => makeOverdueTenant({ ...tenant, bills }))
  return {
    asOfDate: fakeDashboard.overdueAsOf,
    generatedAt: `${fakeDashboard.overdueAsOf}T06:30:00Z`,
    tenantCount: tenants.length,
    billCount: tenants.reduce((sum, tenant) => sum + tenant.bills.length, 0),
    totalOutstanding: tenants.reduce((sum, tenant) => sum + tenant.outstanding, 0),
    tenants,
  }
}

export const dashboardService = {
  getSummary: vi.fn(),
  getRentalPeriods: vi.fn(),
  markNotOwed: vi.fn(),
  getOverdueBills: vi.fn(),
}

export function resetDashboardService() {
  Object.assign(fakeDashboard, defaults())
  dashboardService.getSummary.mockReset().mockImplementation(async () => fakeDashboard.summary)
  dashboardService.getRentalPeriods
    .mockReset()
    .mockImplementation(async (_propertyId: string, filters?: PeriodFilters, page?: number) =>
      periodPage(filters, page),
    )
  dashboardService.getOverdueBills
    .mockReset()
    .mockImplementation(async (filters?: OverdueFilters) => overdueBills(filters))
  dashboardService.markNotOwed
    .mockReset()
    .mockImplementation(async (_propertyId: string, periodId: string) => {
      fakeDashboard.periods = fakeDashboard.periods.filter((period) => period.id !== periodId)
    })
}

resetDashboardService()
