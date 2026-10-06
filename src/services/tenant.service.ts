import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type { Tenant, TenantPage } from '@/types/tenant'

// The backend's tenancy, as GET /api/v1/properties/{propertyId}/tenancies/ returns it. Kept
// separate from the app's Tenant: a backend rename stops here.
export interface TenancyDto {
  id: string
  propertyId: string
  name: string
  flatNumber: string
  mobileNumber: string
  // Decimal strings ("15000.00"): Django is authoritative for money.
  rentAmount: string
  rentDueDay: number
  electricityRate: string
  depositAmount: string
  startDate: string
  endDate: string | null
  status: 'upcoming' | 'current' | 'ended'
}

const STATUSES: readonly TenancyDto['status'][] = ['upcoming', 'current', 'ended']
const DECIMAL = /^\d+(\.\d{1,2})?$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalid(what: string): never {
  throw new ApiError('invalid-response', `Unexpected ${what} in tenancy response`)
}

// Validates the response rather than trusting its shape: a malformed tenancy is an error,
// never a tenant with NaN rent.
export function parseTenancy(value: unknown): TenancyDto {
  if (!isRecord(value)) invalid('tenancy')

  for (const key of ['id', 'propertyId', 'name', 'flatNumber', 'mobileNumber'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '') invalid(key)
  }
  for (const key of ['rentAmount', 'electricityRate', 'depositAmount'] as const) {
    if (typeof value[key] !== 'string' || !DECIMAL.test(value[key])) invalid(key)
  }
  if (!Number.isInteger(value.rentDueDay)) invalid('rentDueDay')
  if (typeof value.startDate !== 'string' || !ISO_DATE.test(value.startDate)) invalid('startDate')
  if (
    value.endDate !== null &&
    (typeof value.endDate !== 'string' || !ISO_DATE.test(value.endDate))
  ) {
    invalid('endDate')
  }
  if (!STATUSES.includes(value.status as TenancyDto['status'])) invalid('status')

  return value as unknown as TenancyDto
}

// The app keeps the name Tenant; its id is now the backend tenancy id. Money becomes numbers
// here, deliberately, for the existing display and preview calculations.
export function toTenant(dto: TenancyDto): Tenant {
  return {
    id: dto.id,
    name: dto.name,
    flatNumber: dto.flatNumber,
    mobileNumber: dto.mobileNumber,
    rentAmount: Number(dto.rentAmount),
    rentDueDay: dto.rentDueDay,
    electricityRate: Number(dto.electricityRate),
    depositAmount: Number(dto.depositAmount),
    startDate: dto.startDate,
    endDate: dto.endDate,
  }
}

export function parseTenantPage(data: unknown, page: number): TenantPage {
  if (
    !isRecord(data) ||
    !Number.isInteger(data.count) ||
    !Array.isArray(data.results) ||
    (data.next !== null && typeof data.next !== 'string')
  ) {
    invalid('page')
  }

  return {
    tenants: data.results.map((item) => toTenant(parseTenancy(item))),
    count: data.count as number,
    page,
    hasMore: data.next !== null,
  }
}

function tenanciesUrl(propertyId: string) {
  return `/properties/${encodeURIComponent(propertyId)}/tenancies/`
}

export const tenantService = {
  // The property's current tenancies, optionally searched by name or flat number. Pages are
  // asked for by number; hasMore says whether to offer Load more.
  async getTenants(
    propertyId: string,
    options: { search?: string; page?: number } = {},
  ): Promise<TenantPage> {
    const page = options.page ?? 1
    const params: Record<string, string | number> = { status: 'current' }
    const search = options.search?.trim()
    if (search) params.search = search
    if (page > 1) params.page = page

    let data: unknown
    try {
      data = (await api.get(tenanciesUrl(propertyId), { params })).data
    } catch (error) {
      throw toApiError(error)
    }

    return parseTenantPage(data, page)
  },

  // One tenancy of any status (ended ones too, for history). Not found is ApiError 'not-found'.
  async getTenant(propertyId: string, tenancyId: string): Promise<Tenant> {
    let data: unknown
    try {
      data = (await api.get(`${tenanciesUrl(propertyId)}${encodeURIComponent(tenancyId)}/`)).data
    } catch (error) {
      throw toApiError(error)
    }

    return toTenant(parseTenancy(data))
  },
}
