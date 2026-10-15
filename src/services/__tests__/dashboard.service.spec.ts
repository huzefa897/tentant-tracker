import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'
import {
  dashboardService,
  parseMissingBills,
  parsePendingPage,
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
  outstandingAmount: '39500.00',
  overdueAmount: '5750.00',
  dueTodayAmount: '0.00',
  dueNext7DaysAmount: '18000.00',
  withoutDueDateAmount: '0.00',
  pendingTenancyCount: 2,
  overdueTenancyCount: 1,
}

const rowDto = {
  tenancyId: '0b9d7a1e-0000-4000-8000-000000000101',
  name: 'Shaik Zahid Ali',
  flatNumber: '202',
  tenancyStatus: 'ended',
  outstandingAmount: '21500.00',
  overdueAmount: '5750.00',
  dueTodayAmount: '0.00',
  dueNext7DaysAmount: '0.00',
  withoutDueDateAmount: '0.00',
  pendingBillCount: 2,
  oldestDueDate: '2026-10-11',
  oldestOverdueDate: '2026-10-11',
}

const missingDto = {
  billingMonth: '2026-09',
  count: 1,
  tenancies: [
    {
      tenancyId: '0b9d7a1e-0000-4000-8000-000000000103',
      name: 'Ali Hussain',
      flatNumber: '102',
      tenancyStatus: 'current',
      rentAmount: '14000.00',
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseSummary', () => {
  it('maps the backend’s totals, money as numbers', () => {
    expect(parseSummary(summaryDto)).toEqual({
      asOfDate: '2026-10-15',
      generatedAt: '2026-10-15T06:30:00Z',
      outstanding: 39500,
      overdue: 5750,
      dueToday: 0,
      dueNext7Days: 18000,
      withoutDueDate: 0,
      pendingTenancyCount: 2,
      overdueTenancyCount: 1,
    })
  })

  it.each([
    ['money as a number', { outstandingAmount: 39500 }],
    ['money with one decimal', { overdueAmount: '5750.0' }],
    ['a missing amount', { dueTodayAmount: undefined }],
    ['another currency', { currency: 'USD' }],
    ['a bad date', { asOfDate: '15/10/2026' }],
    ['a negative count', { pendingTenancyCount: -1 }],
    ['a fractional count', { overdueTenancyCount: 1.5 }],
  ])('rejects %s', (_, change) => {
    expect(() => parseSummary({ ...summaryDto, ...change })).toThrow(ApiError)
  })
})

describe('parsePendingPage', () => {
  it('maps the rows and paging', () => {
    const page = parsePendingPage(
      { count: 21, next: 'http://x/?page=2', previous: null, results: [rowDto] },
      1,
    )

    expect(page).toMatchObject({ count: 21, page: 1, hasNext: true, hasPrevious: false })
    expect(page.tenancies[0]).toEqual({
      tenantId: rowDto.tenancyId,
      name: 'Shaik Zahid Ali',
      flatNumber: '202',
      tenancyStatus: 'ended',
      outstanding: 21500,
      overdue: 5750,
      dueToday: 0,
      dueNext7Days: 0,
      withoutDueDate: 0,
      pendingBillCount: 2,
      oldestDueDate: '2026-10-11',
      oldestOverdueDate: '2026-10-11',
    })
  })

  it.each([
    ['no results', { results: undefined }],
    ['an unknown tenancy status', { results: [{ ...rowDto, tenancyStatus: 'gone' }] }],
    ['a bad due date', { results: [{ ...rowDto, oldestDueDate: '2026-10' }] }],
    ['an empty name', { results: [{ ...rowDto, name: '' }] }],
  ])('rejects %s', (_, change) => {
    const data: Record<string, unknown> = { count: 1, next: null, previous: null }
    Object.assign(data, { results: [rowDto] }, change)
    expect(() => parsePendingPage(data, 1)).toThrow(ApiError)
  })
})

describe('parseMissingBills', () => {
  it('maps the month and its tenancies', () => {
    expect(parseMissingBills(missingDto)).toEqual({
      billingMonth: '2026-09',
      tenancies: [
        {
          tenantId: missingDto.tenancies[0]!.tenancyId,
          name: 'Ali Hussain',
          flatNumber: '102',
          tenancyStatus: 'current',
          rentAmount: 14000,
        },
      ],
    })
  })

  it('rejects a bad month', () => {
    expect(() => parseMissingBills({ ...missingDto, billingMonth: '2026-13' })).toThrow(ApiError)
  })
})

describe('dashboardService', () => {
  it('asks for the summary, a filtered page and a month', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/summary/')) return { data: summaryDto }
      if (url.endsWith('/pending-tenancies/')) {
        return { data: { count: 1, next: null, previous: null, results: [rowDto] } }
      }
      return { data: missingDto }
    })

    await dashboardService.getSummary(PROPERTY_ID)
    await dashboardService.getPendingTenancies(PROPERTY_ID)
    await dashboardService.getPendingTenancies(PROPERTY_ID, { due: 'overdue', page: 2 })
    await dashboardService.getMissingBills(PROPERTY_ID)
    await dashboardService.getMissingBills(PROPERTY_ID, '2026-08')

    expect(get.mock.calls).toEqual([
      [`${BASE}/summary/`, { params: {} }],
      [`${BASE}/pending-tenancies/`, { params: {} }],
      [`${BASE}/pending-tenancies/`, { params: { due_status: 'overdue', page: 2 } }],
      [`${BASE}/missing-bills/`, { params: {} }],
      [`${BASE}/missing-bills/`, { params: { billing_month: '2026-08' } }],
    ])
  })

  it('turns request failures into app errors', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'))

    await expect(dashboardService.getSummary(PROPERTY_ID)).rejects.toBeInstanceOf(ApiError)
  })
})
