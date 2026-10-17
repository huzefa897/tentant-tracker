import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type {
  BillPreparation,
  DashboardSummary,
  OverdueBill,
  OverdueBills,
  OverdueFilters,
  OverdueTenant,
  PeriodAction,
  PeriodFilters,
  PeriodTiming,
  RentalPeriodPage,
  RentalPeriodRow,
  Settlement,
} from '@/types/dashboard'
import type { PaymentTiming } from '@/types/rentEntry'
import type { TenantStatus } from '@/types/tenant'

// The property dashboard's API (backend billing/dashboard_views.py). Money arrives as decimal
// strings and becomes numbers here, for display only: the figures are the backend's. An amount
// that isn't known yet (a month without a bill) arrives as null and stays null.

const MONEY = /^\d+\.\d{2}$/
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const TENANCY_STATUSES: readonly TenantStatus[] = ['upcoming', 'current', 'ended']
const PAYMENT_TIMINGS: readonly PaymentTiming[] = ['prepaid', 'postpaid']
const TIMINGS: readonly PeriodTiming[] = ['overdue', 'due_today', 'upcoming']
const PREPARATIONS: readonly BillPreparation[] = ['prepared', 'not_prepared']
const SETTLEMENTS: readonly Settlement[] = ['unknown', 'unpaid', 'partially_paid', 'paid']
const ACTIONS: readonly PeriodAction[] = [
  'prepare_bill',
  'mark_not_owed',
  'view_bill',
  'record_payment',
]

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

function optionalMoney(data: Data, key: string): number | null {
  return data[key] === null ? null : money(data, key)
}

function count(data: Data, key: string): number {
  const value = data[key]
  if (!Number.isInteger(value) || (value as number) < 0) invalid(key)
  return value as number
}

function matching(data: Data, key: string, pattern: RegExp): string {
  const value = text(data, key)
  if (!pattern.test(value)) invalid(key)
  return value
}

function oneOf<T extends string>(data: Data, key: string, choices: readonly T[]): T {
  const value = data[key]
  if (!choices.includes(value as T)) invalid(key)
  return value as T
}

export function parseSummary(value: unknown): DashboardSummary {
  const data = record(value, 'summary')
  if (data.currency !== 'INR') invalid('currency')
  return {
    asOfDate: matching(data, 'asOfDate', DATE),
    generatedAt: text(data, 'generatedAt'),
    overduePeriodCount: count(data, 'overduePeriodCount'),
    overdueTenancyCount: count(data, 'overdueTenancyCount'),
    dueTodayPeriodCount: count(data, 'dueTodayPeriodCount'),
    upcomingPeriodCount: count(data, 'upcomingPeriodCount'),
    awaitingBillPeriodCount: count(data, 'awaitingBillPeriodCount'),
    overdueAwaitingBillPeriodCount: count(data, 'overdueAwaitingBillPeriodCount'),
    owingTenancyCount: count(data, 'owingTenancyCount'),
    knownOutstanding: money(data, 'knownOutstandingAmount'),
    knownOverdue: money(data, 'knownOverdueAmount'),
    knownDueToday: money(data, 'knownDueTodayAmount'),
    knownUpcoming: money(data, 'knownUpcomingAmount'),
  }
}

export function parseRentalPeriod(value: unknown): RentalPeriodRow {
  const data = record(value, 'rental period')
  const preparation = oneOf(data, 'preparation', PREPARATIONS)
  const prepared = preparation === 'prepared'
  const billId = data.billId === null ? null : text(data, 'billId')
  const totalDue = optionalMoney(data, 'totalDue')
  const outstanding = optionalMoney(data, 'outstandingAmount')
  const settlement = oneOf(data, 'settlement', SETTLEMENTS)
  // A prepared month has its bill and amounts; one awaiting its bill has neither, and its
  // settlement is unknown. Anything else is a contract break, not something to guess at.
  if (prepared !== (billId !== null) || prepared !== (totalDue !== null)) invalid('preparation')
  if (prepared !== (outstanding !== null)) invalid('outstandingAmount')
  if (prepared === (settlement === 'unknown')) invalid('settlement')
  if (!Array.isArray(data.actions)) invalid('actions')
  for (const action of data.actions) {
    if (!ACTIONS.includes(action as PeriodAction)) invalid('actions')
  }
  return {
    id: text(data, 'id'),
    tenantId: text(data, 'tenancyId'),
    name: text(data, 'name'),
    flatNumber: text(data, 'flatNumber'),
    tenancyStatus: oneOf(data, 'tenancyStatus', TENANCY_STATUSES),
    periodMonth: matching(data, 'periodMonth', MONTH),
    paymentTiming: oneOf(data, 'paymentTiming', PAYMENT_TIMINGS),
    dueDate: matching(data, 'dueDate', DATE),
    timing: oneOf(data, 'timing', TIMINGS),
    daysOverdue: count(data, 'daysOverdue'),
    preparation,
    billId,
    settlement,
    totalDue,
    outstanding,
    actions: data.actions as PeriodAction[],
  }
}

export function parsePeriodPage(value: unknown, page: number): RentalPeriodPage {
  const data = record(value, 'page')
  if (!Array.isArray(data.results)) invalid('results')
  for (const key of ['next', 'previous'] as const) {
    if (data[key] !== null && typeof data[key] !== 'string') invalid(key)
  }
  return {
    periods: data.results.map(parseRentalPeriod),
    count: count(data, 'count'),
    page,
    hasNext: data.next !== null,
    hasPrevious: data.previous !== null,
  }
}

function parseOverdueBill(value: unknown): OverdueBill {
  const data = record(value, 'overdue bill')
  return {
    id: text(data, 'id'),
    billingMonth: matching(data, 'billingMonth', MONTH),
    dueDate: matching(data, 'dueDate', DATE),
    daysOverdue: count(data, 'daysOverdue'),
    totalAmount: money(data, 'totalAmount'),
    paidAmount: money(data, 'paidAmount'),
    outstanding: money(data, 'outstandingAmount'),
  }
}

function parseOverdueTenant(value: unknown): OverdueTenant {
  const data = record(value, 'overdue tenant')
  if (!Array.isArray(data.bills) || data.bills.length === 0) invalid('bills')
  const bills = data.bills.map(parseOverdueBill)
  if (bills.some((bill) => bill.daysOverdue < 1 || bill.outstanding <= 0)) invalid('bills')
  const overdueBillCount = count(data, 'overdueBillCount')
  if (overdueBillCount !== bills.length) invalid('overdueBillCount')
  return {
    tenantId: text(data, 'tenancyId'),
    name: text(data, 'name'),
    flatNumber: text(data, 'flatNumber'),
    tenancyStatus: oneOf(data, 'tenancyStatus', TENANCY_STATUSES),
    propertyId: text(data, 'propertyId'),
    propertyName: text(data, 'propertyName'),
    overdueBillCount,
    outstanding: money(data, 'outstandingAmount'),
    oldestDueDate: matching(data, 'oldestDueDate', DATE),
    bills,
  }
}

export function parseOverdueBills(value: unknown): OverdueBills {
  const data = record(value, 'overdue bills')
  if (data.currency !== 'INR') invalid('currency')
  if (!Array.isArray(data.tenants)) invalid('tenants')
  const tenants = data.tenants.map(parseOverdueTenant)
  const tenantCount = count(data, 'tenantCount')
  if (tenantCount !== tenants.length) invalid('tenantCount')
  return {
    asOfDate: matching(data, 'asOfDate', DATE),
    generatedAt: text(data, 'generatedAt'),
    tenantCount,
    billCount: count(data, 'billCount'),
    totalOutstanding: money(data, 'totalOutstandingAmount'),
    tenants,
  }
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
  // Counts of rental periods and the amounts known from prepared bills, as of today at the
  // property.
  async getSummary(propertyId: string): Promise<DashboardSummary> {
    return parseSummary(await get(dashboardUrl(propertyId, 'summary')))
  },

  // One page of months still owed, oldest due first. The filters never change the summary.
  async getRentalPeriods(
    propertyId: string,
    filters: PeriodFilters,
    page = 1,
  ): Promise<RentalPeriodPage> {
    const params: Record<string, string | number> = {}
    if (filters.timing !== 'due') params.timing = filters.timing
    if (filters.preparation !== 'all') params.preparation = filters.preparation
    if (filters.month) params.month = filters.month
    if (page > 1) params.page = page
    return parsePeriodPage(await get(dashboardUrl(propertyId, 'rental-periods'), params), page)
  },

  // Every overdue bill across the user's properties, grouped by tenant. Not paged.
  async getOverdueBills(filters: OverdueFilters): Promise<OverdueBills> {
    const params: Record<string, string> = {}
    if (filters.propertyId) params.property = filters.propertyId
    if (filters.month) params.month = filters.month
    const search = filters.search.trim()
    if (search) params.search = search
    return parseOverdueBills(await get('/overdue-bills/', params))
  },

  // Marks a month's rent as not owed (owners only), with why. A retry with the same reason is
  // accepted again; the backend refuses a month with a bill.
  async markNotOwed(propertyId: string, periodId: string, reason: string): Promise<void> {
    const url = `/properties/${encodeURIComponent(propertyId)}/rental-periods/${encodeURIComponent(periodId)}/not-owed/`
    try {
      await api.post(url, { reason })
    } catch (error) {
      throw toApiError(error)
    }
  },
}
