import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type {
  DashboardSummary,
  DueFilter,
  MissingBills,
  MissingBillTenancy,
  PendingTenancy,
  PendingTenancyPage,
} from '@/types/dashboard'
import type { TenantStatus } from '@/types/tenant'

// The property dashboard's API (backend billing/dashboard_views.py). Money arrives as decimal
// strings and becomes numbers here, for display only: the figures are the backend's.

const MONEY = /^\d+\.\d{2}$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const TENANCY_STATUSES: readonly TenantStatus[] = ['upcoming', 'current', 'ended']

type Data = Record<string, unknown>

function isRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null
}

function invalid(what: string): never {
  throw new ApiError('invalid-response', `Unexpected ${what} in dashboard response`)
}

function record(value: unknown, what: string): Data {
  if (!isRecord(value)) invalid(what)
  return value
}

function text(data: Data, key: string): string {
  const value = data[key]
  if (typeof value !== 'string' || value === '') invalid(key)
  return value
}

function money(data: Data, key: string): number {
  const value = data[key]
  if (typeof value !== 'string' || !MONEY.test(value)) invalid(key)
  return Number(value)
}

function count(data: Data, key: string): number {
  const value = data[key]
  if (!Number.isInteger(value) || (value as number) < 0) invalid(key)
  return value as number
}

function optionalDate(data: Data, key: string): string | null {
  const value = data[key]
  if (value === null) return null
  if (typeof value !== 'string' || !DATE.test(value)) invalid(key)
  return value
}

function tenancyStatus(data: Data): TenantStatus {
  const value = data.tenancyStatus
  if (!TENANCY_STATUSES.includes(value as TenantStatus)) invalid('tenancyStatus')
  return value as TenantStatus
}

export function parseSummary(value: unknown): DashboardSummary {
  const data = record(value, 'summary')
  const asOfDate = optionalDate(data, 'asOfDate')
  if (asOfDate === null) invalid('asOfDate')
  if (data.currency !== 'INR') invalid('currency')
  return {
    asOfDate,
    generatedAt: text(data, 'generatedAt'),
    outstanding: money(data, 'outstandingAmount'),
    overdue: money(data, 'overdueAmount'),
    dueToday: money(data, 'dueTodayAmount'),
    dueNext7Days: money(data, 'dueNext7DaysAmount'),
    withoutDueDate: money(data, 'withoutDueDateAmount'),
    pendingTenancyCount: count(data, 'pendingTenancyCount'),
    overdueTenancyCount: count(data, 'overdueTenancyCount'),
  }
}

export function parsePendingTenancy(value: unknown): PendingTenancy {
  const data = record(value, 'pending tenancy')
  return {
    tenantId: text(data, 'tenancyId'),
    name: text(data, 'name'),
    flatNumber: text(data, 'flatNumber'),
    tenancyStatus: tenancyStatus(data),
    outstanding: money(data, 'outstandingAmount'),
    overdue: money(data, 'overdueAmount'),
    dueToday: money(data, 'dueTodayAmount'),
    dueNext7Days: money(data, 'dueNext7DaysAmount'),
    withoutDueDate: money(data, 'withoutDueDateAmount'),
    pendingBillCount: count(data, 'pendingBillCount'),
    oldestDueDate: optionalDate(data, 'oldestDueDate'),
    oldestOverdueDate: optionalDate(data, 'oldestOverdueDate'),
  }
}

export function parsePendingPage(value: unknown, page: number): PendingTenancyPage {
  const data = record(value, 'page')
  if (!Array.isArray(data.results)) invalid('results')
  for (const key of ['next', 'previous'] as const) {
    if (data[key] !== null && typeof data[key] !== 'string') invalid(key)
  }
  return {
    tenancies: data.results.map(parsePendingTenancy),
    count: count(data, 'count'),
    page,
    hasNext: data.next !== null,
    hasPrevious: data.previous !== null,
  }
}

function parseMissingTenancy(value: unknown): MissingBillTenancy {
  const data = record(value, 'missing bill')
  return {
    tenantId: text(data, 'tenancyId'),
    name: text(data, 'name'),
    flatNumber: text(data, 'flatNumber'),
    tenancyStatus: tenancyStatus(data),
    rentAmount: money(data, 'rentAmount'),
  }
}

export function parseMissingBills(value: unknown): MissingBills {
  const data = record(value, 'missing bills')
  const billingMonth = text(data, 'billingMonth')
  if (!MONTH.test(billingMonth)) invalid('billingMonth')
  if (!Array.isArray(data.tenancies)) invalid('tenancies')
  return { billingMonth, tenancies: data.tenancies.map(parseMissingTenancy) }
}

function dashboardUrl(propertyId: string, name: string) {
  return `/properties/${encodeURIComponent(propertyId)}/dashboard/${name}/`
}

async function get(url: string, params: Record<string, string | number> = {}): Promise<unknown> {
  try {
    return (await api.get(url, { params })).data
  } catch (error) {
    throw toApiError(error)
  }
}

export const dashboardService = {
  // Property-wide totals as of today at the property.
  async getSummary(propertyId: string): Promise<DashboardSummary> {
    return parseSummary(await get(dashboardUrl(propertyId, 'summary')))
  },

  // One page of tenancies that owe money, overdue first. A filter keeps the tenancies with
  // money in that window; it never changes the summary.
  async getPendingTenancies(
    propertyId: string,
    options: { due?: DueFilter; page?: number } = {},
  ): Promise<PendingTenancyPage> {
    const page = options.page ?? 1
    const params: Record<string, string | number> = {}
    if (options.due && options.due !== 'all') params.due_status = options.due
    if (page > 1) params.page = page
    return parsePendingPage(await get(dashboardUrl(propertyId, 'pending-tenancies'), params), page)
  },

  // Tenancies occupying the month (YYYY-MM) with no bill for it; without a month, the backend
  // picks the one whose bills should exist by now.
  async getMissingBills(propertyId: string, billingMonth?: string | null): Promise<MissingBills> {
    const params: Record<string, string> = billingMonth ? { billing_month: billingMonth } : {}
    return parseMissingBills(await get(dashboardUrl(propertyId, 'missing-bills'), params))
  },
}
