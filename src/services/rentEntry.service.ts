import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type {
  PaymentStatus,
  RentEntry,
  RentEntryFilters,
  RentEntryInput,
  RentEntryPage,
} from '@/types/rentEntry'

// A bill as the backend returns it (GET/POST .../tenancies/{tenancyId}/entries/). Kept separate
// from the app's RentEntry: a backend rename stops here.
export interface RentEntryDto {
  id: string
  tenancyId: string
  billingMonth: string // YYYY-MM
  // Decimal strings ("15000.00"): Django is authoritative for money.
  rentAmount: string
  electricityUnits: string // three decimals, "75.000"
  electricityRate: string
  electricityAmount: string
  waterAmount: string
  totalDue: string
  totalPaid: string
  outstandingAmount: string
  paymentStatus: PaymentStatus
  notes: string
  createdAt: string
}

// What a new bill sends. No electricity rate (the server takes the tenancy's), tenancy, creator
// or payment: the server assigns or refuses those.
export interface CreateRentEntryDto {
  billingMonth: string
  // Left out to charge the tenancy's current rent.
  rentAmount?: string
  electricityUnits: string
  waterAmount: string
  notes: string
}

const STATUSES: readonly PaymentStatus[] = ['unpaid', 'partially_paid', 'paid']
const MONEY = /^-?\d+\.\d{2}$/
const UNITS = /^\d+\.\d{3}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invalid(what: string): never {
  throw new ApiError('invalid-response', `Unexpected ${what} in rent entry response`)
}

// Validates the response rather than trusting its shape: a malformed bill is an error, never a
// bill with NaN rent.
export function parseRentEntry(value: unknown): RentEntryDto {
  if (!isRecord(value)) invalid('entry')

  for (const key of ['id', 'tenancyId', 'createdAt'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '') invalid(key)
  }
  if (typeof value.billingMonth !== 'string' || !MONTH.test(value.billingMonth)) {
    invalid('billingMonth')
  }
  for (const key of [
    'rentAmount',
    'electricityRate',
    'electricityAmount',
    'waterAmount',
    'totalDue',
    'totalPaid',
    'outstandingAmount',
  ] as const) {
    if (typeof value[key] !== 'string' || !MONEY.test(value[key])) invalid(key)
  }
  if (typeof value.electricityUnits !== 'string' || !UNITS.test(value.electricityUnits)) {
    invalid('electricityUnits')
  }
  if (!STATUSES.includes(value.paymentStatus as PaymentStatus)) invalid('paymentStatus')
  if (typeof value.notes !== 'string') invalid('notes')

  return value as unknown as RentEntryDto
}

// Money becomes numbers here, deliberately, for display. The figures are the backend's.
export function toRentEntry(dto: RentEntryDto): RentEntry {
  return {
    id: dto.id,
    tenantId: dto.tenancyId,
    billingMonth: dto.billingMonth,
    rentAmount: Number(dto.rentAmount),
    electricityUnits: Number(dto.electricityUnits),
    electricityRate: Number(dto.electricityRate),
    electricityAmount: Number(dto.electricityAmount),
    waterAmount: Number(dto.waterAmount),
    totalDue: Number(dto.totalDue),
    totalPaid: Number(dto.totalPaid),
    outstanding: Number(dto.outstandingAmount),
    status: dto.paymentStatus,
    notes: dto.notes,
    createdAt: dto.createdAt,
  }
}

// Decimal strings, so the backend never parses a float. Validation has already limited the
// decimals (utils/rentEntryValidation.ts), so toFixed doesn't round anything away. An unedited
// rent is left out, so the backend charges the tenancy's rent as it is now.
export function toCreateRentEntryDto(input: RentEntryInput): CreateRentEntryDto {
  return {
    billingMonth: input.billingMonth,
    ...(input.useTenancyRent ? {} : { rentAmount: input.rentAmount.toFixed(2) }),
    electricityUnits: input.electricityUnits.toFixed(3),
    waterAmount: input.waterAmount.toFixed(2),
    notes: input.notes,
  }
}

export function parseRentEntryPage(data: unknown, page: number): RentEntryPage {
  if (
    !isRecord(data) ||
    !Number.isInteger(data.count) ||
    !Array.isArray(data.results) ||
    (data.next !== null && typeof data.next !== 'string') ||
    (data.previous !== null && typeof data.previous !== 'string')
  ) {
    invalid('page')
  }

  return {
    entries: data.results.map((item) => toRentEntry(parseRentEntry(item))),
    count: data.count as number,
    page,
    hasNext: data.next !== null,
    hasPrevious: data.previous !== null,
  }
}

function entriesUrl(propertyId: string, tenancyId: string) {
  return `/properties/${encodeURIComponent(propertyId)}/tenancies/${encodeURIComponent(tenancyId)}/entries/`
}

async function request<T>(send: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await send()).data
  } catch (error) {
    throw toApiError(error)
  }
}

export const rentEntryService = {
  // Saves a new bill. The response is authoritative: its rate and totals may differ from the
  // form's preview (e.g. the tenancy's rate changed meanwhile). A month that already has a bill
  // is ApiError 'conflict' (code 'duplicate_billing_month'); rejected fields are
  // 'invalid-request' with fieldErrors.
  async createEntry(propertyId: string, tenancyId: string, input: RentEntryInput) {
    const data = await request(() =>
      api.post(entriesUrl(propertyId, tenancyId), toCreateRentEntryDto(input)),
    )
    return toRentEntry(parseRentEntry(data))
  },

  // One page of the tenancy's bills, newest billing month first. billingMonth finds one month's
  // bill, e.g. to check whether a save that timed out went through.
  async getEntries(
    propertyId: string,
    tenancyId: string,
    filters: RentEntryFilters = {},
  ): Promise<RentEntryPage> {
    const page = filters.page ?? 1
    const params: Record<string, string | number> = {}
    if (filters.year) params.year = filters.year
    if (filters.billingMonth) params.billing_month = filters.billingMonth
    if (page > 1) params.page = page

    const data = await request(() => api.get(entriesUrl(propertyId, tenancyId), { params }))
    return parseRentEntryPage(data, page)
  },

  // One bill of this tenancy. Another tenancy's bill (or none) is ApiError 'not-found'.
  async getEntry(propertyId: string, tenancyId: string, entryId: string): Promise<RentEntry> {
    const data = await request(() =>
      api.get(`${entriesUrl(propertyId, tenancyId)}${encodeURIComponent(entryId)}/`),
    )
    return toRentEntry(parseRentEntry(data))
  },
}
