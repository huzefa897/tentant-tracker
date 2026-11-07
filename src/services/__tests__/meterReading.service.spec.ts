import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'
import {
  meterReadingService,
  parseElectricity,
  parseTenantMeter,
  toMeterReadingDto,
} from '@/services/meterReading.service'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const PROPERTY_ID = '6f1c2a4e-0000-4000-8000-000000000001'
const TENANCY_ID = '0b9d7a1e-0000-4000-8000-000000000101'
const READING_ID = '3a5c7e9f-0000-4000-8000-000000000601'
const URL = `/properties/${PROPERTY_ID}/tenancies/${TENANCY_ID}/meter-readings/`
const KEY = '2c4e6a8b-0000-4000-8000-000000000301'

const readingDto = {
  id: READING_ID,
  reading: '2876.500',
  readOn: '2026-11-30',
  notes: '',
  status: 'active',
  consumption: '313.500',
  billedBy: null,
  createdAt: '2026-11-30T08:00:00Z',
  voidedAt: null,
  voidedByName: null,
  voidReason: '',
  replacesReadingId: null,
  replacedByReadingId: null,
}

const meterDto = {
  baseline: { reading: '2400.000', readOn: '2026-09-01' },
  lastBilled: { id: null, reading: '2563.000', readOn: '2026-10-31' },
  readings: [readingDto],
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

describe('parseTenantMeter', () => {
  it('maps readings to numbers, newest first as sent', () => {
    expect(parseTenantMeter(meterDto)).toEqual({
      baseline: { reading: 2400, readOn: '2026-09-01' },
      lastBilled: { id: null, reading: 2563, readOn: '2026-10-31' },
      readings: [
        {
          id: READING_ID,
          reading: 2876.5,
          readOn: '2026-11-30',
          notes: '',
          status: 'active',
          consumption: 313.5,
          billedBy: null,
          createdAt: '2026-11-30T08:00:00Z',
          voided: null,
          replacesReadingId: null,
          replacedByReadingId: null,
        },
      ],
    })
  })

  it('accepts a meter that isn’t set up', () => {
    expect(parseTenantMeter({ baseline: null, lastBilled: null, readings: [] })).toEqual({
      baseline: null,
      lastBilled: null,
      readings: [],
    })
  })

  it('maps a void reading’s details', () => {
    const meter = parseTenantMeter({
      ...meterDto,
      readings: [
        {
          ...readingDto,
          status: 'void',
          consumption: null,
          voidedAt: '2026-12-01T08:00:00Z',
          voidedByName: 'Huzefa',
          voidReason: 'Misread',
        },
      ],
    })
    expect(meter.readings[0]!.voided).toEqual({
      at: '2026-12-01T08:00:00Z',
      byName: 'Huzefa',
      reason: 'Misread',
    })
  })

  it.each([
    ['a number reading', { ...meterDto, baseline: { reading: 2400, readOn: '2026-09-01' } }],
    ['a baseline without last billed', { ...meterDto, lastBilled: null }],
    ['no readings list', { baseline: null, lastBilled: null }],
    ['a bad date', { ...meterDto, readings: [{ ...readingDto, readOn: '30/11/2026' }] }],
    ['an unknown status', { ...meterDto, readings: [{ ...readingDto, status: 'deleted' }] }],
    [
      'a void reading with consumption',
      {
        ...meterDto,
        readings: [
          { ...readingDto, status: 'void', voidedAt: 'x', voidedByName: 'y', voidReason: 'z' },
        ],
      },
    ],
    [
      'an active reading with void details',
      { ...meterDto, readings: [{ ...readingDto, voidReason: 'z' }] },
    ],
    ['a bad billedBy', { ...meterDto, readings: [{ ...readingDto, billedBy: { id: 'e1' } }] }],
  ])('rejects %s', (_label, data) => {
    expect(() => parseTenantMeter(data)).toThrow(ApiError)
  })
})

describe('parseElectricity', () => {
  const point = { id: READING_ID, reading: '2563.000', readOn: '2026-10-31' }

  it('needs both readings on a meter bill and none otherwise', () => {
    expect(
      parseElectricity(
        { electricityMode: 'meter', openingReading: point, closingReading: point },
        true,
      ).electricityMode,
    ).toBe('meter')
    expect(
      parseElectricity(
        { electricityMode: 'not_charged', openingReading: null, closingReading: null },
        true,
      ).closingReading,
    ).toBeNull()
    expect(() =>
      parseElectricity(
        { electricityMode: 'meter', openingReading: point, closingReading: null },
        true,
      ),
    ).toThrow(ApiError)
    expect(() =>
      parseElectricity(
        { electricityMode: 'manual', openingReading: null, closingReading: point },
        true,
      ),
    ).toThrow(ApiError)
    expect(() =>
      parseElectricity(
        { electricityMode: 'solar', openingReading: null, closingReading: null },
        true,
      ),
    ).toThrow(ApiError)
  })

  it('lets only a receipt’s opening reading go undated (the baseline)', () => {
    const undated = { reading: '2400.000', readOn: null }
    const receiptPoint = { reading: '2563.000', readOn: '2026-10-31' }
    expect(
      parseElectricity(
        { electricityMode: 'meter', openingReading: undated, closingReading: receiptPoint },
        false,
      ).openingReading,
    ).toEqual(undated)
    expect(() =>
      parseElectricity(
        { electricityMode: 'meter', openingReading: receiptPoint, closingReading: undated },
        false,
      ),
    ).toThrow(ApiError)
    expect(() =>
      parseElectricity(
        {
          electricityMode: 'meter',
          openingReading: { ...undated, id: null },
          closingReading: point,
        },
        true,
      ),
    ).toThrow(ApiError)
  })
})

describe('toMeterReadingDto', () => {
  it('sends the reading as a three-decimal string', () => {
    expect(toMeterReadingDto({ reading: 2876.5, readOn: '2026-11-30', notes: 'Kitchen' })).toEqual({
      reading: '2876.500',
      readOn: '2026-11-30',
      notes: 'Kitchen',
    })
  })
})

describe('meterReadingService', () => {
  it('gets the meter', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: meterDto })
    const meter = await meterReadingService.getMeter(PROPERTY_ID, TENANCY_ID)
    expect(get).toHaveBeenCalledWith(URL)
    expect(meter.lastBilled?.reading).toBe(2563)
  })

  it('records a reading with its idempotency key', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ status: 201, data: { reading: READING_ID, meter: meterDto } })
    const result = await meterReadingService.recordReading(
      PROPERTY_ID,
      TENANCY_ID,
      { reading: 2876.5, readOn: '2026-11-30', notes: '' },
      KEY,
    )
    expect(post).toHaveBeenCalledWith(
      URL,
      { reading: '2876.500', readOn: '2026-11-30', notes: '' },
      { headers: { 'Idempotency-Key': KEY } },
    )
    expect(result.readingId).toBe(READING_ID)
    expect(result.replayed).toBe(false)
  })

  it('says when a retry was already recorded', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      status: 200,
      data: { reading: READING_ID, meter: meterDto },
    })
    const result = await meterReadingService.recordReading(
      PROPERTY_ID,
      TENANCY_ID,
      { reading: 2876.5, readOn: '2026-11-30', notes: '' },
      KEY,
    )
    expect(result.replayed).toBe(true)
  })

  it('voids and corrects at the reading’s URL', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ status: 201, data: { reading: READING_ID, meter: meterDto } })
    await meterReadingService.voidReading(PROPERTY_ID, TENANCY_ID, READING_ID, 'Misread')
    expect(post).toHaveBeenLastCalledWith(
      `${URL}${READING_ID}/void/`,
      { reason: 'Misread' },
      undefined,
    )
    await meterReadingService.correctReading(
      PROPERTY_ID,
      TENANCY_ID,
      READING_ID,
      { reading: 2870, readOn: '2026-11-30', notes: '', reason: 'Misread' },
      KEY,
    )
    expect(post).toHaveBeenLastCalledWith(
      `${URL}${READING_ID}/correction/`,
      { reason: 'Misread', reading: '2870.000', readOn: '2026-11-30', notes: '' },
      { headers: { 'Idempotency-Key': KEY } },
    )
  })

  it('throws app errors, with a conflict’s blocking bills', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      httpError(409, {
        code: 'reading_in_use',
        detail: 'In use',
        entries: [{ id: 'e1', billingMonth: '2026-12' }],
      }),
    )
    const error = await meterReadingService
      .voidReading(PROPERTY_ID, TENANCY_ID, READING_ID, 'Misread')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('reading_in_use')
    expect((error as ApiError).details.entries).toEqual([{ id: 'e1', billingMonth: '2026-12' }])
  })

  it('rejects a write response without the meter', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ status: 201, data: { reading: READING_ID } })
    await expect(
      meterReadingService.voidReading(PROPERTY_ID, TENANCY_ID, READING_ID, 'Misread'),
    ).rejects.toMatchObject({ kind: 'invalid-response' })
  })
})
