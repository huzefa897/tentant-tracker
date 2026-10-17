import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'
import {
  dashboardService,
  parseOverdueBills,
  parsePeriodPage,
  parseRentalPeriod,
  parseSummary,
} from '@/services/dashboard.service'

// The real service: src/test/setup.ts mocks it for every other test.
vi.unmock('@/services/dashboard.service')
vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const PROPERTY_ID = '6f1c2a4e-0000-4000-8000-000000000001'
const BASE = `/properties/${PROPERTY_ID}/dashboard`

const summaryDto = {
  asOfDate: '2026-10-15',
  generatedAt: '2026-10-15T06:30:00Z',
  currency: 'INR',
  overduePeriodCount: 2,
  overdueTenancyCount: 2,
  dueTodayPeriodCount: 0,
  upcomingPeriodCount: 1,
  awaitingBillPeriodCount: 2,
  overdueAwaitingBillPeriodCount: 1,
  owingTenancyCount: 2,
  knownOutstandingAmount: '5750.00',
  knownOverdueAmount: '5750.00',
  knownDueTodayAmount: '0.00',
  knownUpcomingAmount: '0.00',
}

const billedDto = {
  id: '9c0d7a1e-0000-4000-8000-000000000201',
  tenancyId: '0b9d7a1e-0000-4000-8000-000000000101',
  name: 'Shaik Zahid Ali',
  flatNumber: '202',
  tenancyStatus: 'ended',
  periodMonth: '2026-09',
  paymentTiming: 'postpaid',
  dueDate: '2026-10-11',
  timing: 'overdue',
  daysOverdue: 4,
  preparation: 'prepared',
  billId: '7a0d7a1e-0000-4000-8000-000000000301',
  settlement: 'partially_paid',
  totalDue: '15750.00',
  outstandingAmount: '5750.00',
  actions: ['view_bill', 'record_payment'],
}

const unbilledDto = {
  ...billedDto,
  id: '9c0d7a1e-0000-4000-8000-000000000202',
  periodMonth: '2026-08',
  dueDate: '2026-09-11',
  daysOverdue: 34,
  preparation: 'not_prepared',
  billId: null,
  settlement: 'unknown',
  totalDue: null,
  outstandingAmount: null,
  actions: ['prepare_bill', 'mark_not_owed'],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseSummary', () => {
  it('maps counts of months and tenants, and the known amounts as numbers', () => {
    expect(parseSummary(summaryDto)).toEqual({
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
    })
  })

  it.each([
    ['money as a number', { knownOutstandingAmount: 5750 }],
    ['money with one decimal', { knownOverdueAmount: '5750.0' }],
    ['a missing amount', { knownDueTodayAmount: undefined }],
    ['another currency', { currency: 'USD' }],
    ['a bad date', { asOfDate: '15/10/2026' }],
    ['a negative count', { overduePeriodCount: -1 }],
    ['a fractional count', { awaitingBillPeriodCount: 1.5 }],
  ])('rejects %s', (_, change) => {
    expect(() => parseSummary({ ...summaryDto, ...change })).toThrow(ApiError)
  })
})

describe('parseRentalPeriod', () => {
  it('maps a prepared month with its amounts', () => {
    expect(parseRentalPeriod(billedDto)).toEqual({
      id: billedDto.id,
      tenantId: billedDto.tenancyId,
      name: 'Shaik Zahid Ali',
      flatNumber: '202',
      tenancyStatus: 'ended',
      periodMonth: '2026-09',
      paymentTiming: 'postpaid',
      dueDate: '2026-10-11',
      timing: 'overdue',
      daysOverdue: 4,
      preparation: 'prepared',
      billId: billedDto.billId,
      settlement: 'partially_paid',
      totalDue: 15750,
      outstanding: 5750,
      actions: ['view_bill', 'record_payment'],
    })
  })

  it('keeps a month awaiting its bill without an amount, never a zero', () => {
    expect(parseRentalPeriod(unbilledDto)).toMatchObject({
      preparation: 'not_prepared',
      billId: null,
      settlement: 'unknown',
      totalDue: null,
      outstanding: null,
      actions: ['prepare_bill', 'mark_not_owed'],
    })
  })

  it.each([
    ['an unknown timing', { ...billedDto, timing: 'late' }],
    ['a bad month', { ...billedDto, periodMonth: '2026-13' }],
    ['an unknown action', { ...billedDto, actions: ['delete'] }],
    ['a prepared month without its amount', { ...billedDto, outstandingAmount: null }],
    ['a prepared month without its bill', { ...billedDto, billId: null }],
    ['an amount for a month without a bill', { ...unbilledDto, outstandingAmount: '0.00' }],
    ['a known settlement without a bill', { ...unbilledDto, settlement: 'unpaid' }],
    ['an unknown settlement with a bill', { ...billedDto, settlement: 'unknown' }],
    ['a negative days overdue', { ...billedDto, daysOverdue: -1 }],
  ])('rejects %s', (_, dto) => {
    expect(() => parseRentalPeriod(dto)).toThrow(ApiError)
  })
})

describe('parsePeriodPage', () => {
  it('maps the rows and paging', () => {
    const page = parsePeriodPage(
      { count: 21, next: 'http://x/?page=2', previous: null, results: [billedDto, unbilledDto] },
      1,
    )

    expect(page).toMatchObject({ count: 21, page: 1, hasNext: true, hasPrevious: false })
    expect(page.periods.map((period) => period.periodMonth)).toEqual(['2026-09', '2026-08'])
  })

  it('rejects a page without results', () => {
    expect(() => parsePeriodPage({ count: 0, next: null, previous: null }, 1)).toThrow(ApiError)
  })
})

const overdueDto = {
  asOfDate: '2026-10-15',
  generatedAt: '2026-10-15T06:30:00Z',
  currency: 'INR',
  tenantCount: 1,
  billCount: 1,
  totalOutstandingAmount: '5750.00',
  tenants: [
    {
      tenancyId: '0b9d7a1e-0000-4000-8000-000000000101',
      name: 'Shaik Zahid Ali',
      flatNumber: '202',
      tenancyStatus: 'current',
      propertyId: PROPERTY_ID,
      propertyName: 'Saleem Towers',
      overdueBillCount: 1,
      outstandingAmount: '5750.00',
      oldestDueDate: '2026-10-11',
      bills: [
        {
          id: '7a0d7a1e-0000-4000-8000-000000000301',
          billingMonth: '2026-09',
          dueDate: '2026-10-11',
          daysOverdue: 4,
          totalAmount: '15750.00',
          paidAmount: '10000.00',
          outstandingAmount: '5750.00',
        },
      ],
    },
  ],
}

function overdueWith(tenant: Record<string, unknown>, bill: Record<string, unknown> = {}) {
  const [first] = overdueDto.tenants
  return {
    ...overdueDto,
    tenants: [{ ...first, bills: [{ ...first!.bills[0], ...bill }], ...tenant }],
  }
}

describe('parseOverdueBills', () => {
  it('maps tenants and their overdue bills, money as numbers', () => {
    expect(parseOverdueBills(overdueDto)).toEqual({
      asOfDate: '2026-10-15',
      generatedAt: '2026-10-15T06:30:00Z',
      tenantCount: 1,
      billCount: 1,
      totalOutstanding: 5750,
      tenants: [
        {
          tenantId: '0b9d7a1e-0000-4000-8000-000000000101',
          name: 'Shaik Zahid Ali',
          flatNumber: '202',
          tenancyStatus: 'current',
          propertyId: PROPERTY_ID,
          propertyName: 'Saleem Towers',
          overdueBillCount: 1,
          outstanding: 5750,
          oldestDueDate: '2026-10-11',
          bills: [
            {
              id: '7a0d7a1e-0000-4000-8000-000000000301',
              billingMonth: '2026-09',
              dueDate: '2026-10-11',
              daysOverdue: 4,
              totalAmount: 15750,
              paidAmount: 10000,
              outstanding: 5750,
            },
          ],
        },
      ],
    })
  })

  it('maps an empty list', () => {
    expect(
      parseOverdueBills({ ...overdueDto, tenantCount: 0, billCount: 0, tenants: [] }).tenants,
    ).toEqual([])
  })

  it.each([
    ['no tenants', { ...overdueDto, tenants: undefined }],
    ['a wrong tenant count', { ...overdueDto, tenantCount: 2 }],
    ['another currency', { ...overdueDto, currency: 'USD' }],
    ['a tenant without bills', overdueWith({ bills: [] })],
    ['a wrong bill count', overdueWith({ overdueBillCount: 2 })],
    ['a paid bill', overdueWith({}, { outstandingAmount: '0.00' })],
    ['a bill not yet overdue', overdueWith({}, { daysOverdue: 0 })],
    ['a bad month', overdueWith({}, { billingMonth: '2026-13' })],
    ['money as a number', overdueWith({}, { paidAmount: 10000 })],
  ])('rejects %s', (_, dto) => {
    expect(() => parseOverdueBills(dto)).toThrow(ApiError)
  })
})

describe('dashboardService', () => {
  it('asks for overdue bills with only the filters set', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: overdueDto })

    await dashboardService.getOverdueBills({ propertyId: null, month: null, search: '  ' })
    await dashboardService.getOverdueBills({
      propertyId: PROPERTY_ID,
      month: '2026-09',
      search: ' flat 202 ',
    })

    expect(get.mock.calls).toEqual([
      ['/overdue-bills/', { params: {} }],
      [
        '/overdue-bills/',
        { params: { property: PROPERTY_ID, month: '2026-09', search: 'flat 202' } },
      ],
    ])
  })

  it('asks for the summary and a filtered page', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/summary/')) return { data: summaryDto }
      return { data: { count: 1, next: null, previous: null, results: [billedDto] } }
    })

    await dashboardService.getSummary(PROPERTY_ID)
    await dashboardService.getRentalPeriods(PROPERTY_ID, {
      timing: 'due',
      preparation: 'all',
      month: null,
    })
    await dashboardService.getRentalPeriods(
      PROPERTY_ID,
      { timing: 'overdue', preparation: 'not_prepared', month: '2026-09' },
      2,
    )

    expect(get.mock.calls).toEqual([
      [`${BASE}/summary/`, { params: {} }],
      [`${BASE}/rental-periods/`, { params: {} }],
      [
        `${BASE}/rental-periods/`,
        { params: { timing: 'overdue', preparation: 'not_prepared', month: '2026-09', page: 2 } },
      ],
    ])
  })

  it('marks a month not owed with its reason', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: {} })

    await dashboardService.markNotOwed(PROPERTY_ID, 'period-1', 'Waived')

    expect(post).toHaveBeenCalledWith(
      `/properties/${PROPERTY_ID}/rental-periods/period-1/not-owed/`,
      { reason: 'Waived' },
    )
  })

  it('turns request failures into app errors', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'))
    vi.spyOn(api, 'post').mockRejectedValue(new Error('boom'))

    await expect(dashboardService.getSummary(PROPERTY_ID)).rejects.toBeInstanceOf(ApiError)
    await expect(
      dashboardService.markNotOwed(PROPERTY_ID, 'period-1', 'Waived'),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
