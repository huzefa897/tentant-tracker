import { vi } from 'vitest'

import type {
  DashboardSummary,
  PeriodFilters,
  RentalPeriodPage,
  RentalPeriodRow,
} from '@/types/dashboard'

// A fake dashboardService, mocked for every test in src/test/setup.ts (the dashboard is where
// sign-in lands, so no test may reach the API through it). It filters and pages
// fakeDashboard.periods like the API; the summary is what tests set. markNotOwed removes the
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

export const dashboardService = {
  getSummary: vi.fn(),
  getRentalPeriods: vi.fn(),
  markNotOwed: vi.fn(),
}

export function resetDashboardService() {
  Object.assign(fakeDashboard, defaults())
  dashboardService.getSummary.mockReset().mockImplementation(async () => fakeDashboard.summary)
  dashboardService.getRentalPeriods
    .mockReset()
    .mockImplementation(async (_propertyId: string, filters?: PeriodFilters, page?: number) =>
      periodPage(filters, page),
    )
  dashboardService.markNotOwed
    .mockReset()
    .mockImplementation(async (_propertyId: string, periodId: string) => {
      fakeDashboard.periods = fakeDashboard.periods.filter((period) => period.id !== periodId)
    })
}

resetDashboardService()
