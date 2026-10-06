import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'
import {
  parseRentEntry,
  parseRentEntryPage,
  rentEntryService,
  toCreateRentEntryDto,
  toRentEntry,
} from '@/services/rentEntry.service'
import type { RentEntryInput } from '@/types/rentEntry'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const PROPERTY_ID = '6f1c2a4e-0000-4000-8000-000000000001'
const TENANCY_ID = '0b9d7a1e-0000-4000-8000-000000000101'
const ENTRIES_URL = `/properties/${PROPERTY_ID}/tenancies/${TENANCY_ID}/entries/`

const dto = {
  id: '5d0c9b2a-0000-4000-8000-000000000201',
  tenancyId: TENANCY_ID,
  billingMonth: '2026-10',
  rentAmount: '15000.00',
  electricityUnits: '75.000',
  electricityRate: '6.00',
  electricityAmount: '450.00',
  waterAmount: '300.00',
  totalDue: '15750.00',
  totalPaid: '0.00',
  outstandingAmount: '15750.00',
  paymentStatus: 'unpaid',
  notes: 'October charges',
  createdAt: '2026-10-05T12:30:00+05:30',
}

const input: RentEntryInput = {
  tenantId: TENANCY_ID,
  billingMonth: '2026-10',
  rentAmount: 15000,
  electricityUnits: 1.125,
  electricityRate: 6,
  waterAmount: 300.5,
  notes: 'October charges',
}

function page(results: unknown[], next: string | null = null, previous: string | null = null) {
  return { count: results.length, next, previous, results }
}

function httpError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError('failed', undefined, config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toRentEntry', () => {
  it('maps the backend’s bill to the app’s, keeping its figures', () => {
    expect(toRentEntry(parseRentEntry(dto))).toEqual({
      id: dto.id,
      tenantId: TENANCY_ID,
      billingMonth: '2026-10',
      rentAmount: 15000,
      electricityUnits: 75,
      electricityRate: 6,
      electricityAmount: 450,
      waterAmount: 300,
      totalDue: 15750,
      totalPaid: 0,
      outstanding: 15750,
      status: 'unpaid',
      notes: 'October charges',
      createdAt: '2026-10-05T12:30:00+05:30',
    })
  })
})

describe('parseRentEntry', () => {
  it.each([
    ['a missing id', { id: undefined }],
    ['a bad billing month', { billingMonth: '2026-13' }],
    ['a full date as the month', { billingMonth: '2026-10-01' }],
    ['money as a number', { totalDue: 15750 }],
    ['money with three decimals', { rentAmount: '1.005' }],
    ['units with two decimals', { electricityUnits: '75.00' }],
    ['an unknown status', { paymentStatus: 'overdue' }],
    ['missing notes', { notes: null }],
  ])('rejects %s', (_, change) => {
    expect(() => parseRentEntry({ ...dto, ...change })).toThrow(ApiError)
  })
})

describe('toCreateRentEntryDto', () => {
  it('sends decimal strings and never the rate', () => {
    expect(toCreateRentEntryDto(input)).toEqual({
      billingMonth: '2026-10',
      rentAmount: '15000.00',
      electricityUnits: '1.125',
      waterAmount: '300.50',
      notes: 'October charges',
    })
  })

  it('leaves out an unedited rent, so the backend charges the tenancy’s current rent', () => {
    expect(toCreateRentEntryDto({ ...input, useTenancyRent: true })).toEqual({
      billingMonth: '2026-10',
      electricityUnits: '1.125',
      waterAmount: '300.50',
      notes: 'October charges',
    })
    expect(toCreateRentEntryDto({ ...input, useTenancyRent: false })).toHaveProperty(
      'rentAmount',
      '15000.00',
    )
  })
})

describe('parseRentEntryPage', () => {
  it('keeps the count and whether there are pages either side', () => {
    expect(parseRentEntryPage(page([dto], 'http://x/?page=3', 'http://x/'), 2)).toMatchObject({
      count: 1,
      page: 2,
      hasNext: true,
      hasPrevious: true,
    })
    expect(parseRentEntryPage(page([dto]), 1)).toMatchObject({ hasNext: false, hasPrevious: false })
  })

  it('rejects a response that isn’t a page', () => {
    expect(() => parseRentEntryPage([dto], 1)).toThrow(ApiError)
    expect(() => parseRentEntryPage({ count: 1, next: null, previous: null }, 1)).toThrow(ApiError)
  })
})

describe('rentEntryService', () => {
  it('creates a bill under its property and tenancy', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: dto })

    const entry = await rentEntryService.createEntry(PROPERTY_ID, TENANCY_ID, input)

    expect(post).toHaveBeenCalledWith(ENTRIES_URL, toCreateRentEntryDto(input))
    expect(entry.totalDue).toBe(15750)
  })

  it('reports a duplicate month as a conflict with its code', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      httpError(409, { code: 'duplicate_billing_month', detail: 'Exists.' }),
    )

    await expect(
      rentEntryService.createEntry(PROPERTY_ID, TENANCY_ID, input),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'duplicate_billing_month' })
  })

  it('reports rejected fields', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      httpError(400, { billingMonth: ['This month is outside the tenancy’s occupancy period.'] }),
    )

    await expect(
      rentEntryService.createEntry(PROPERTY_ID, TENANCY_ID, input),
    ).rejects.toMatchObject({
      kind: 'invalid-request',
      fieldErrors: { billingMonth: 'This month is outside the tenancy’s occupancy period.' },
    })
  })

  it('lists bills with the year, month and page filters', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: page([dto]) })

    await rentEntryService.getEntries(PROPERTY_ID, TENANCY_ID)
    const result = await rentEntryService.getEntries(PROPERTY_ID, TENANCY_ID, {
      year: '2026',
      billingMonth: '2026-10',
      page: 2,
    })

    expect(get).toHaveBeenNthCalledWith(1, ENTRIES_URL, { params: {} })
    expect(get).toHaveBeenNthCalledWith(2, ENTRIES_URL, {
      params: { year: '2026', billing_month: '2026-10', page: 2 },
    })
    expect(result.page).toBe(2)
    expect(result.entries.map((entry) => entry.billingMonth)).toEqual(['2026-10'])
  })

  it('gets one bill under its tenancy', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: dto })

    const entry = await rentEntryService.getEntry(PROPERTY_ID, TENANCY_ID, dto.id)

    expect(get).toHaveBeenCalledWith(`${ENTRIES_URL}${dto.id}/`)
    expect(entry.id).toBe(dto.id)
  })

  it('reports a missing bill as not-found', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(httpError(404, { detail: 'Not found.' }))

    await expect(rentEntryService.getEntry(PROPERTY_ID, TENANCY_ID, dto.id)).rejects.toMatchObject({
      kind: 'not-found',
    })
  })

  it('reports a malformed response as invalid, never as a bill', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { ...dto, totalDue: 'lots' } })

    await expect(rentEntryService.getEntry(PROPERTY_ID, TENANCY_ID, dto.id)).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })
})
