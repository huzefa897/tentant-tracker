import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'
import { parseTenancy, parseTenantPage, tenantService, toTenant } from '@/services/tenant.service'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const PROPERTY_ID = '6f1c2a4e-0000-4000-8000-000000000001'

const dto = {
  id: '0b9d7a1e-0000-4000-8000-000000000101',
  propertyId: PROPERTY_ID,
  name: 'Shaik Zahid Ali',
  flatNumber: '202',
  mobileNumber: '+919000000101',
  rentAmount: '15000.00',
  rentDueDay: 11,
  electricityRate: '6.50',
  depositAmount: '90000.00',
  startDate: '2026-01-01',
  endDate: null,
  status: 'current',
}

function page(results: unknown[], next: string | null = null) {
  return { count: results.length, next, previous: null, results }
}

function respondWith(data: unknown) {
  return vi.spyOn(api, 'get').mockResolvedValue({ data })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toTenant', () => {
  it('maps a tenancy to the app’s Tenant, converting money deliberately', () => {
    expect(toTenant(parseTenancy(dto))).toEqual({
      id: dto.id,
      name: 'Shaik Zahid Ali',
      flatNumber: '202',
      mobileNumber: '+919000000101',
      rentAmount: 15000,
      rentDueDay: 11,
      electricityRate: 6.5,
      depositAmount: 90000,
      startDate: '2026-01-01',
      endDate: null,
    })
  })
})

describe('parseTenancy', () => {
  it.each([
    ['a missing name', { name: undefined }],
    ['an empty flat number', { flatNumber: '' }],
    ['money as a number', { rentAmount: 15000 }],
    ['money with three decimals', { depositAmount: '1.005' }],
    ['negative money', { electricityRate: '-1.00' }],
    ['a fractional due day', { rentDueDay: 1.5 }],
    ['a bad start date', { startDate: '01/01/2026' }],
    ['a bad end date', { endDate: 'soon' }],
    ['an unknown status', { status: 'active' }],
  ])('rejects %s', (_, change) => {
    expect(() => parseTenancy({ ...dto, ...change })).toThrow(ApiError)
  })

  it('accepts an end date', () => {
    expect(parseTenancy({ ...dto, endDate: '2026-12-31', status: 'current' }).endDate).toBe(
      '2026-12-31',
    )
  })
})

describe('parseTenantPage', () => {
  it('keeps the count and whether more pages exist', () => {
    expect(parseTenantPage(page([dto], 'http://x/?page=2'), 1)).toMatchObject({
      count: 1,
      page: 1,
      hasMore: true,
    })
    expect(parseTenantPage(page([dto]), 2).hasMore).toBe(false)
  })

  it('rejects a response that isn’t a page', () => {
    expect(() => parseTenantPage([dto], 1)).toThrow(ApiError)
    expect(() => parseTenantPage({ count: 1, next: null }, 1)).toThrow(ApiError)
  })
})

describe('tenantService', () => {
  it('asks for the property’s current tenancies, with the search', async () => {
    const get = respondWith(page([dto]))

    const result = await tenantService.getTenants(PROPERTY_ID, { search: '  zahid ' })

    expect(get).toHaveBeenCalledWith(`/properties/${PROPERTY_ID}/tenancies/`, {
      params: { status: 'current', search: 'zahid' },
    })
    expect(result.tenants.map((t) => t.name)).toEqual(['Shaik Zahid Ali'])
  })

  it('asks for later pages by number and leaves out an empty search', async () => {
    const get = respondWith(page([]))

    const result = await tenantService.getTenants(PROPERTY_ID, { search: ' ', page: 3 })

    expect(get).toHaveBeenCalledWith(`/properties/${PROPERTY_ID}/tenancies/`, {
      params: { status: 'current', page: 3 },
    })
    expect(result.page).toBe(3)
  })

  it('gets one tenancy under its property', async () => {
    const get = respondWith(dto)

    const tenant = await tenantService.getTenant(PROPERTY_ID, dto.id)

    expect(get).toHaveBeenCalledWith(`/properties/${PROPERTY_ID}/tenancies/${dto.id}/`)
    expect(tenant.rentAmount).toBe(15000)
  })

  it('reports a missing tenancy as not-found', async () => {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
    vi.spyOn(api, 'get').mockRejectedValue(
      new AxiosError('Not found', undefined, config, undefined, {
        status: 404,
        statusText: '',
        headers: {},
        config,
        data: { detail: 'No Tenancy matches the given query.' },
      }),
    )

    await expect(tenantService.getTenant(PROPERTY_ID, dto.id)).rejects.toMatchObject({
      kind: 'not-found',
    })
  })

  it('reports a malformed response as invalid, never as a tenant', async () => {
    respondWith({ ...dto, rentAmount: 'lots' })

    await expect(tenantService.getTenant(PROPERTY_ID, dto.id)).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })
})
