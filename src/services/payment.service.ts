import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import { parseRentEntry, toRentEntry } from '@/services/rentEntry.service'
import type { Payment, PaymentInput, RecordedPayment } from '@/types/payment'

// A payment as the backend returns it (.../entries/{entryId}/payments/).
export interface PaymentDto {
  id: string
  entryId: string
  amount: string // decimal string, "3000.00"
  paidDate: string // YYYY-MM-DD
  notes: string
  createdAt: string
}

// What a payment sends. The bill comes from the URL, the creator from the signed-in user, and
// balances are derived: the server assigns or refuses those.
export interface CreatePaymentDto {
  amount: string
  paidDate: string
  notes: string
}

const MONEY = /^\d+\.\d{2}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(what: string): never {
  throw new ApiError('invalid-response', `Unexpected ${what} in payment response`)
}

export function parsePayment(value: unknown): PaymentDto {
  if (!isRecord(value)) invalid('payment')

  for (const key of ['id', 'entryId', 'createdAt'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '') invalid(key)
  }
  if (typeof value.amount !== 'string' || !MONEY.test(value.amount)) invalid('amount')
  if (typeof value.paidDate !== 'string' || !DATE.test(value.paidDate)) invalid('paidDate')
  if (typeof value.notes !== 'string') invalid('notes')

  return value as unknown as PaymentDto
}

export function toPayment(dto: PaymentDto): Payment {
  return {
    id: dto.id,
    entryId: dto.entryId,
    amount: Number(dto.amount),
    paidDate: dto.paidDate,
    notes: dto.notes,
    createdAt: dto.createdAt,
  }
}

// Validation has already limited the amount to two decimals, so toFixed rounds nothing away.
export function toCreatePaymentDto(input: Omit<PaymentInput, 'entryId'>): CreatePaymentDto {
  return {
    amount: input.amount.toFixed(2),
    paidDate: input.paidDate,
    notes: input.notes,
  }
}

// The bill's outstanding amount a payment_exceeds_outstanding conflict reports, so the form can
// show the current figure. null for any other error, or one without a valid amount.
export function outstandingFromConflict(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'payment_exceeds_outstanding') return null
  const value = error.details.outstandingAmount
  return typeof value === 'string' && MONEY.test(value) ? Number(value) : null
}

function paymentsUrl(propertyId: string, tenancyId: string, entryId: string) {
  return (
    `/properties/${encodeURIComponent(propertyId)}/tenancies/${encodeURIComponent(tenancyId)}` +
    `/entries/${encodeURIComponent(entryId)}/payments/`
  )
}

export const paymentService = {
  // Records a payment against a bill. idempotencyKey identifies one intended payment: a retry
  // (e.g. after a timeout) must reuse it, so the money is never recorded twice; a new payment
  // needs a new one. Errors: 'conflict' with code 'payment_exceeds_outstanding' (see
  // outstandingFromConflict) or 'idempotency_conflict' (the key was used for another request);
  // 'invalid-request' with fieldErrors.
  async recordPayment(
    propertyId: string,
    tenancyId: string,
    input: PaymentInput,
    idempotencyKey: string,
  ): Promise<RecordedPayment> {
    let response
    try {
      response = await api.post(
        paymentsUrl(propertyId, tenancyId, input.entryId),
        toCreatePaymentDto(input),
        { headers: { 'Idempotency-Key': idempotencyKey } },
      )
    } catch (error) {
      throw toApiError(error)
    }

    const data: unknown = response.data
    if (!isRecord(data)) invalid('response')
    return {
      payment: toPayment(parsePayment(data.payment)),
      entry: toRentEntry(parseRentEntry(data.entry)),
      replayed: response.status === 200,
    }
  },

  // Every payment of the bill, newest paid date first (then newest recorded).
  async getPayments(propertyId: string, tenancyId: string, entryId: string): Promise<Payment[]> {
    let data: unknown
    try {
      data = (await api.get(paymentsUrl(propertyId, tenancyId, entryId))).data
    } catch (error) {
      throw toApiError(error)
    }

    if (!Array.isArray(data)) invalid('payment list')
    return data.map((item) => toPayment(parsePayment(item)))
  },
}
