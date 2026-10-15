import { vi } from 'vitest'

import type {
  DashboardSummary,
  DueFilter,
  MissingBills,
  PendingTenancy,
  PendingTenancyPage,
} from '@/types/dashboard'

// A fake dashboardService, mocked for every test in src/test/setup.ts (the dashboard is where
// sign-in lands, so no test may reach the API through it). It filters and pages
// fakeDashboard.pending like the API; the summary and missing bills are what tests set.
// Fictional people; the ids are the tenant fake's (tenant-001…).

export function makePendingTenancy(overrides: Partial<PendingTenancy> = {}): PendingTenancy {
  return {
    tenantId: 'tenant-001',
    name: 'Shaik Zahid Ali',
    flatNumber: '202',
    tenancyStatus: 'current',
    outstanding: 21500,
    overdue: 5750,
    dueToday: 0,
    dueNext7Days: 0,
    withoutDueDate: 0,
    pendingBillCount: 2,
    oldestDueDate: '2026-10-11',
    oldestOverdueDate: '2026-10-11',
    ...overrides,
  }
}

export function makeSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    asOfDate: '2026-10-15',
    generatedAt: '2026-10-15T06:30:00Z',
    outstanding: 39500,
    overdue: 5750,
    dueToday: 0,
    dueNext7Days: 18000,
    withoutDueDate: 0,
    pendingTenancyCount: 2,
    overdueTenancyCount: 1,
    ...overrides,
  }
}

function defaults() {
  return {
    summary: makeSummary(),
    pending: [
      makePendingTenancy(),
      makePendingTenancy({
        tenantId: 'tenant-002',
        name: 'Mohammed Yusuf',
        flatNumber: '301',
        outstanding: 18000,
        overdue: 0,
        dueNext7Days: 18000,
        pendingBillCount: 1,
        oldestDueDate: '2026-10-20',
        oldestOverdueDate: null,
      }),
    ],
    missing: {
      billingMonth: '2026-09',
      tenancies: [
        {
          tenantId: 'tenant-003',
          name: 'Ali Hussain',
          flatNumber: '102',
          tenancyStatus: 'current',
          rentAmount: 14000,
        },
      ],
    } as MissingBills,
    pageSize: 20,
  }
}

export const fakeDashboard = defaults()

const IN_WINDOW: Record<Exclude<DueFilter, 'all'>, keyof PendingTenancy> = {
  overdue: 'overdue',
  due_today: 'dueToday',
  due_next_7_days: 'dueNext7Days',
}

export function pendingPage(options: { due?: DueFilter; page?: number } = {}): PendingTenancyPage {
  const due = options.due ?? 'all'
  const page = options.page ?? 1
  const matches =
    due === 'all'
      ? fakeDashboard.pending
      : fakeDashboard.pending.filter((t) => (t[IN_WINDOW[due]] as number) > 0)
  const start = (page - 1) * fakeDashboard.pageSize
  return {
    tenancies: matches.slice(start, start + fakeDashboard.pageSize),
    count: matches.length,
    page,
    hasNext: start + fakeDashboard.pageSize < matches.length,
    hasPrevious: page > 1,
  }
}

export const dashboardService = {
  getSummary: vi.fn(),
  getPendingTenancies: vi.fn(),
  getMissingBills: vi.fn(),
}

export function resetDashboardService() {
  Object.assign(fakeDashboard, defaults())
  dashboardService.getSummary.mockReset().mockImplementation(async () => fakeDashboard.summary)
  dashboardService.getPendingTenancies
    .mockReset()
    .mockImplementation(async (_propertyId: string, options?: { due?: DueFilter; page?: number }) =>
      pendingPage(options),
    )
  dashboardService.getMissingBills
    .mockReset()
    .mockImplementation(async (_propertyId: string, month?: string | null) => ({
      ...fakeDashboard.missing,
      billingMonth: month ?? fakeDashboard.missing.billingMonth,
    }))
}

resetDashboardService()
