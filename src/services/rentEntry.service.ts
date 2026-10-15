import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type {
  BillStatus,
  CorrectedEntry,
  DueStatus,
  EntryCorrectionInput,
  NewRentEntrySubmission,
  PaymentStatus,
  PaymentTiming,
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
  // null for a void bill.
  paymentStatus: PaymentStatus | null
  // All null on a bill from before due dates; dueStatus is also null on a void bill.
  paymentTiming: PaymentTiming | null
  dueDate: string | null // YYYY-MM-DD
  dueStatus: DueStatus | null
  notes: string
  createdAt: string
  status: BillStatus
  // null, null and "" while active.
  voidedAt: string | null
  voidedByName: string | null
  voidReason: string
  replacesEntryId: string | null
  replacedByEntryId: string | null
}

// What a correction sends: the replacement's charges (decimal strings) and why. Never the rate,
// month or tenancy, which are the original's.
export interface EntryCorrectionDto {
  reason: string
  rentAmount: string
  electricityUnits: string
  waterAmount: string
  notes: string
}

// What a new bill sends. No electricity rate (the server takes the tenancy's), tenancy, creator
// or balances: the server assigns or refuses those. A payment received with the bill is saved
// with it, or neither is.
export interface CreateRentEntryDto {
  billingMonth: string
  // Left out to charge the tenancy's current rent.
  rentAmount?: string
  electricityUnits: string
  waterAmount: string
  notes: string
  initialPayment?: {
    amount: string
    paidDate: string
    notes: string
  }
}

const STATUSES: readonly PaymentStatus[] = ['unpaid', 'partially_paid', 'paid']
const BILL_STATUSES: readonly BillStatus[] = ['active', 'void']
const TIMINGS: readonly PaymentTiming[] = ['prepaid', 'postpaid']
const DUE_STATUSES: readonly DueStatus[] = ['settled', 'overdue', 'due_today', 'upcoming']
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
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
  if (typeof value.notes !== 'string') invalid('notes')
  if (!BILL_STATUSES.includes(value.status as BillStatus)) invalid('status')
  const isVoid = value.status === 'void'
  // A void bill has no payment status and records who voided it, when and why; an active one
  // has a payment status and no void details.
  if (isVoid) {
    if (value.paymentStatus !== null) invalid('paymentStatus')
    for (const key of ['voidedAt', 'voidedByName', 'voidReason'] as const) {
      if (typeof value[key] !== 'string' || value[key] === '') invalid(key)
    }
  } else {
    if (!STATUSES.includes(value.paymentStatus as PaymentStatus)) invalid('paymentStatus')
    if (value.voidedAt !== null || value.voidedByName !== null || value.voidReason !== '') {
      invalid('voidedAt')
    }
  }
  for (const key of ['replacesEntryId', 'replacedByEntryId'] as const) {
    if (value[key] !== null && (typeof value[key] !== 'string' || value[key] === '')) invalid(key)
  }
  // The timing and due date come together or not at all (a bill from before due dates); a due
  // status only with a due date, and never on a void bill.
  if (value.dueDate === null) {
    if (value.paymentTiming !== null) invalid('paymentTiming')
    if (value.dueStatus !== null) invalid('dueStatus')
  } else {
    if (typeof value.dueDate !== 'string' || !DATE.test(value.dueDate)) invalid('dueDate')
    if (!TIMINGS.includes(value.paymentTiming as PaymentTiming)) invalid('paymentTiming')
    if (isVoid ? value.dueStatus !== null : !DUE_STATUSES.includes(value.dueStatus as DueStatus)) {
      invalid('dueStatus')
    }
  }

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
    paymentTiming: dto.paymentTiming,
    dueDate: dto.dueDate,
    dueStatus: dto.dueStatus,
    notes: dto.notes,
    createdAt: dto.createdAt,
    billStatus: dto.status,
    voided:
      dto.status === 'void'
        ? { at: dto.voidedAt ?? '', byName: dto.voidedByName ?? '', reason: dto.voidReason }
        : null,
    replacesEntryId: dto.replacesEntryId,
    replacedByEntryId: dto.replacedByEntryId,
  }
}

// Decimal strings, as for a new bill (validation has already limited the decimals).
export function toEntryCorrectionDto(input: EntryCorrectionInput): EntryCorrectionDto {
  return {
    reason: input.reason,
    rentAmount: input.rentAmount.toFixed(2),
    electricityUnits: input.electricityUnits.toFixed(3),
    waterAmount: input.waterAmount.toFixed(2),
    notes: input.notes,
  }
}

function parseCorrection(data: unknown): Omit<CorrectedEntry, 'replayed'> {
  if (!isRecord(data)) invalid('correction')
  const original = toRentEntry(parseRentEntry(data.original))
  const replacement = toRentEntry(parseRentEntry(data.replacement))
  if (
    original.billStatus !== 'void' ||
    replacement.billStatus !== 'active' ||
    replacement.replacesEntryId !== original.id
  ) {
    invalid('correction')
  }
  return { original, replacement }
}

// Decimal strings, so the backend never parses a float. Validation has already limited the
// decimals (utils/rentEntryValidation.ts), so toFixed doesn't round anything away. An unedited
// rent is left out, so the backend charges the tenancy's rent as it is now.
export function toCreateRentEntryDto(
  input: RentEntryInput,
  initialPayment: NewRentEntrySubmission['initialPayment'] = null,
): CreateRentEntryDto {
  const dto: CreateRentEntryDto = {
    billingMonth: input.billingMonth,
    ...(input.useTenancyRent ? {} : { rentAmount: input.rentAmount.toFixed(2) }),
    electricityUnits: input.electricityUnits.toFixed(3),
    waterAmount: input.waterAmount.toFixed(2),
    notes: input.notes,
  }
  if (initialPayment) {
    dto.initialPayment = {
      amount: initialPayment.amount.toFixed(2),
      paidDate: initialPayment.paidDate,
      notes: initialPayment.notes,
    }
  }
  return dto
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
  // Saves a new bill, with the payment received with it if there is one (both or neither). The
  // response is authoritative: its rate and totals may differ from the form's preview (e.g. the
  // tenancy's rate changed meanwhile).
  // idempotencyKey identifies one intended bill: a retry (e.g. after a timeout) must reuse it
  // and gets the bill it created, never a second one.
  // Errors: 'conflict' with code 'duplicate_billing_month' (the month has a bill),
  // 'idempotency_conflict' (the key was used for another request) or
  // 'payment_exceeds_outstanding' (the payment is more than the bill); 'invalid-request' with
  // fieldErrors.
  async createEntry(
    propertyId: string,
    tenancyId: string,
    submission: NewRentEntrySubmission,
    idempotencyKey: string,
  ): Promise<RentEntry> {
    const data = await request(() =>
      api.post(
        entriesUrl(propertyId, tenancyId),
        toCreateRentEntryDto(submission.entry, submission.initialPayment),
        { headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    )
    return toRentEntry(parseRentEntry(data))
  },

  // One page of the tenancy's bills, newest billing month first, filtered by the backend before
  // paging. Active bills only, unless billStatus asks for void ones too ('all') or only them.
  // billingMonth finds one month's active bill, e.g. the one a duplicate save clashed with.
  async getEntries(
    propertyId: string,
    tenancyId: string,
    filters: RentEntryFilters = {},
  ): Promise<RentEntryPage> {
    const page = filters.page ?? 1
    const params: Record<string, string | number> = {}
    if (filters.billStatus && filters.billStatus !== 'active') params.status = filters.billStatus
    if (filters.year) params.year = filters.year
    if (filters.billingMonth) params.billing_month = filters.billingMonth
    if (filters.paymentStatus === 'outstanding') params.balance = 'outstanding'
    else if (filters.paymentStatus) params.payment_status = filters.paymentStatus
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

  // Voids a bill that should not exist (owners only). A retry with the same reason is safe
  // (replayed). Errors: 'forbidden' (a manager); 'conflict' with code 'unreversed_payments'
  // (payments still count: reverse them first) or 'void_conflict' (voided already, for
  // another reason); 'invalid-request' with fieldErrors.
  async voidEntry(
    propertyId: string,
    tenancyId: string,
    entryId: string,
    reason: string,
  ): Promise<{ entry: RentEntry; replayed: boolean }> {
    let response
    try {
      response = await api.post(
        `${entriesUrl(propertyId, tenancyId)}${encodeURIComponent(entryId)}/void/`,
        { reason },
      )
    } catch (error) {
      throw toApiError(error)
    }
    const entry = toRentEntry(parseRentEntry(response.data))
    if (entry.billStatus !== 'void') invalid('status')
    return { entry, replayed: response.status === 200 }
  },

  // Voids a bill with wrong charges and creates its replacement for the same month, together
  // or not at all (owners only). idempotencyKey: one per intended correction, reused by a retry,
  // which returns the correction it made (replayed). Errors: 'forbidden'; 'conflict' with code
  // 'unreversed_payments', 'entry_void' (already void) or 'idempotency_conflict';
  // 'invalid-request' with fieldErrors (nonFieldErrors when nothing changed).
  async correctEntry(
    propertyId: string,
    tenancyId: string,
    entryId: string,
    input: EntryCorrectionInput,
    idempotencyKey: string,
  ): Promise<CorrectedEntry> {
    let response
    try {
      response = await api.post(
        `${entriesUrl(propertyId, tenancyId)}${encodeURIComponent(entryId)}/correction/`,
        toEntryCorrectionDto(input),
        { headers: { 'Idempotency-Key': idempotencyKey } },
      )
    } catch (error) {
      throw toApiError(error)
    }
    return { ...parseCorrection(response.data), replayed: response.status === 200 }
  },
}
