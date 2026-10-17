import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'
import {
  parseRentEntry,
  parseRentEntryPage,
  rentEntryService,
  toCreateRentEntryDto,
  toEntryCorrectionDto,
  toRentEntry,
} from '@/services/rentEntry.service'
import type {
  EntryCorrectionInput,
  NewRentEntrySubmission,
  RentEntryInput,
} from '@/types/rentEntry'

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
  paymentTiming: 'postpaid',
  dueDate: '2026-11-11',
  dueStatus: 'upcoming',
  notes: 'October charges',
  createdAt: '2026-10-05T12:30:00+05:30',
  status: 'active',
  voidedAt: null,
  voidedByName: null,
  voidReason: '',
  replacesEntryId: null,
  replacedByEntryId: null,
}

const REPLACEMENT_ID = '5d0c9b2a-0000-4000-8000-000000000202'

// The same bill, voided by a correction.
const voidDto = {
  ...dto,
  outstandingAmount: '0.00',
  paymentStatus: null,
  dueStatus: null,
  status: 'void',
  voidedAt: '2026-10-08T10:00:00+05:30',
  voidedByName: 'Huzefa',
  voidReason: 'Electricity units were wrong',
  replacedByEntryId: REPLACEMENT_ID,
}

// Its replacement.
const replacementDto = {
  ...dto,
  id: REPLACEMENT_ID,
  electricityUnits: '80.000',
  electricityAmount: '480.00',
  totalDue: '15780.00',
  outstandingAmount: '15780.00',
  replacesEntryId: dto.id,
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

const submission: NewRentEntrySubmission = { entry: input, initialPayment: null }
const KEY = '2c4e6a8b-0000-4000-8000-000000000301'

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
      paymentTiming: 'postpaid',
      dueDate: '2026-11-11',
      dueStatus: 'upcoming',
      notes: 'October charges',
      createdAt: '2026-10-05T12:30:00+05:30',
      billStatus: 'active',
      voided: null,
      replacesEntryId: null,
      replacedByEntryId: null,
    })
  })

  it('maps a void bill: no payment status, who voided it, when and why, and its replacement', () => {
    expect(toRentEntry(parseRentEntry(voidDto))).toMatchObject({
      billStatus: 'void',
      status: null,
      outstanding: 0,
      totalDue: 15750,
      voided: {
        at: '2026-10-08T10:00:00+05:30',
        byName: 'Huzefa',
        reason: 'Electricity units were wrong',
      },
      replacedByEntryId: REPLACEMENT_ID,
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
    ['an unknown bill status', { status: 'deleted' }],
    ['an active bill without a payment status', { paymentStatus: null }],
    ['an active bill with void details', { voidedAt: '2026-10-08T10:00:00+05:30' }],
    ['a void bill with a payment status', { ...voidDto, paymentStatus: 'unpaid' }],
    ['a void bill without its reason', { ...voidDto, voidReason: '' }],
    ['a void bill without who voided it', { ...voidDto, voidedByName: null }],
    ['an empty replacement id', { replacesEntryId: '' }],
    ['a due date that isn’t a date', { dueDate: '2026-11' }],
    ['a due date without its timing', { paymentTiming: null }],
    ['an unknown timing', { paymentTiming: 'monthly' }],
    ['a due status without a due date', { paymentTiming: null, dueDate: null }],
    ['an unknown due status', { dueStatus: 'late' }],
    ['an active bill with a due date but no due status', { dueStatus: null }],
    ['a void bill with a due status', { ...voidDto, dueStatus: 'overdue' }],
  ])('rejects %s', (_, change) => {
    expect(() => parseRentEntry({ ...dto, ...change })).toThrow(ApiError)
  })
})

describe('parseRentEntry due dates', () => {
  it('accepts a bill from before due dates, with none of the three', () => {
    const before = { ...dto, paymentTiming: null, dueDate: null, dueStatus: null }

    expect(toRentEntry(parseRentEntry(before))).toMatchObject({
      paymentTiming: null,
      dueDate: null,
      dueStatus: null,
    })
  })

  it('accepts a void bill with its due date and no due status', () => {
    expect(toRentEntry(parseRentEntry(voidDto))).toMatchObject({
      dueDate: '2026-11-11',
      dueStatus: null,
    })
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

  it('sends a payment received with the bill as initialPayment', () => {
    expect(
      toCreateRentEntryDto(input, { amount: 10000.5, paidDate: '2026-10-05', notes: 'Cash' }),
    ).toMatchObject({
      initialPayment: { amount: '10000.50', paidDate: '2026-10-05', notes: 'Cash' },
    })
    expect(toCreateRentEntryDto(input, null)).not.toHaveProperty('initialPayment')
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
  it('creates a bill under its property and tenancy, with its idempotency key', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: dto })

    const entry = await rentEntryService.createEntry(PROPERTY_ID, TENANCY_ID, submission, KEY)

    expect(post).toHaveBeenCalledWith(ENTRIES_URL, toCreateRentEntryDto(input), {
      headers: { 'Idempotency-Key': KEY },
    })
    expect(entry.totalDue).toBe(15750)
  })

  it('reports a duplicate month as a conflict with its code', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      httpError(409, { code: 'duplicate_billing_month', detail: 'Exists.' }),
    )

    await expect(
      rentEntryService.createEntry(PROPERTY_ID, TENANCY_ID, submission, KEY),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'duplicate_billing_month' })
  })

  it('reports rejected fields', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      httpError(400, { billingMonth: ['This month is outside the tenancy’s occupancy period.'] }),
    )

    await expect(
      rentEntryService.createEntry(PROPERTY_ID, TENANCY_ID, submission, KEY),
    ).rejects.toMatchObject({
      kind: 'invalid-request',
      fieldErrors: { billingMonth: 'This month is outside the tenancy’s occupancy period.' },
    })
  })

  it('lists bills with the bill status, year, month, payment status and page filters', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: page([dto]) })

    await rentEntryService.getEntries(PROPERTY_ID, TENANCY_ID)
    const result = await rentEntryService.getEntries(PROPERTY_ID, TENANCY_ID, {
      year: '2026',
      billingMonth: '2026-10',
      paymentStatus: 'partially_paid',
      page: 2,
    })

    expect(get).toHaveBeenNthCalledWith(1, ENTRIES_URL, { params: {} })
    await rentEntryService.getEntries(PROPERTY_ID, TENANCY_ID, { billStatus: 'active' })
    expect(get).toHaveBeenLastCalledWith(ENTRIES_URL, { params: {} })
    await rentEntryService.getEntries(PROPERTY_ID, TENANCY_ID, { billStatus: 'all' })
    expect(get).toHaveBeenLastCalledWith(ENTRIES_URL, { params: { status: 'all' } })
    expect(get).toHaveBeenNthCalledWith(2, ENTRIES_URL, {
      params: {
        year: '2026',
        billing_month: '2026-10',
        payment_status: 'partially_paid',
        page: 2,
      },
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

  describe('voidEntry', () => {
    const VOID_URL = `${ENTRIES_URL}${dto.id}/void/`

    it('sends the reason and returns the bill, void', async () => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 201, data: voidDto })

      const result = await rentEntryService.voidEntry(PROPERTY_ID, TENANCY_ID, dto.id, 'Twice')

      expect(post).toHaveBeenCalledWith(VOID_URL, { reason: 'Twice' })
      expect(result).toMatchObject({ entry: { billStatus: 'void' }, replayed: false })
    })

    it('says when it was already void for that reason (a retry)', async () => {
      vi.spyOn(api, 'post').mockResolvedValue({ status: 200, data: voidDto })

      const result = await rentEntryService.voidEntry(PROPERTY_ID, TENANCY_ID, dto.id, 'Twice')

      expect(result.replayed).toBe(true)
    })

    it('reports payments that still count as a conflict with its code', async () => {
      vi.spyOn(api, 'post').mockRejectedValue(
        httpError(409, { code: 'unreversed_payments', detail: 'Reverse them first.' }),
      )

      await expect(
        rentEntryService.voidEntry(PROPERTY_ID, TENANCY_ID, dto.id, 'Twice'),
      ).rejects.toMatchObject({ kind: 'conflict', code: 'unreversed_payments' })
    })

    it('refuses a response that isn’t void', async () => {
      vi.spyOn(api, 'post').mockResolvedValue({ status: 201, data: dto })

      await expect(
        rentEntryService.voidEntry(PROPERTY_ID, TENANCY_ID, dto.id, 'Twice'),
      ).rejects.toMatchObject({ kind: 'invalid-response' })
    })
  })

  describe('correctEntry', () => {
    const CORRECTION_URL = `${ENTRIES_URL}${dto.id}/correction/`
    const correction: EntryCorrectionInput = {
      rentAmount: 15000,
      electricityUnits: 80,
      waterAmount: 300.5,
      notes: '',
      reason: 'Units were wrong',
    }

    it('sends decimal strings, never the rate or month', () => {
      expect(toEntryCorrectionDto(correction)).toEqual({
        reason: 'Units were wrong',
        rentAmount: '15000.00',
        electricityUnits: '80.000',
        waterAmount: '300.50',
        notes: '',
      })
    })

    it('sends the correction with its idempotency key and returns both bills', async () => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({
        status: 201,
        data: { original: voidDto, replacement: replacementDto },
      })

      const result = await rentEntryService.correctEntry(
        PROPERTY_ID,
        TENANCY_ID,
        dto.id,
        correction,
        KEY,
      )

      expect(post).toHaveBeenCalledWith(CORRECTION_URL, toEntryCorrectionDto(correction), {
        headers: { 'Idempotency-Key': KEY },
      })
      expect(result.original).toMatchObject({ id: dto.id, billStatus: 'void' })
      expect(result.replacement).toMatchObject({
        id: REPLACEMENT_ID,
        billStatus: 'active',
        replacesEntryId: dto.id,
        totalDue: 15780,
      })
      expect(result.replayed).toBe(false)
    })

    it('says when the backend had already made it (a retry)', async () => {
      vi.spyOn(api, 'post').mockResolvedValue({
        status: 200,
        data: { original: voidDto, replacement: replacementDto },
      })

      const result = await rentEntryService.correctEntry(
        PROPERTY_ID,
        TENANCY_ID,
        dto.id,
        correction,
        KEY,
      )

      expect(result.replayed).toBe(true)
    })

    it.each([
      ['an original that isn’t void', { original: dto, replacement: replacementDto }],
      [
        'an unlinked replacement',
        { original: voidDto, replacement: { ...replacementDto, replacesEntryId: null } },
      ],
      ['a missing replacement', { original: voidDto }],
    ])('refuses %s', async (_, data) => {
      vi.spyOn(api, 'post').mockResolvedValue({ status: 201, data })

      await expect(
        rentEntryService.correctEntry(PROPERTY_ID, TENANCY_ID, dto.id, correction, KEY),
      ).rejects.toMatchObject({ kind: 'invalid-response' })
    })
  })
})
