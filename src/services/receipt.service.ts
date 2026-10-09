import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import { paymentsUrl } from '@/services/payment.service'
import type { IssuedReceipt, PaymentReceipt } from '@/types/receipt'

// A receipt as the backend returns it (.../payments/{paymentId}/receipt/): its saved snapshot,
// money as decimal strings.
export interface ReceiptDto {
  id: string
  reference: string
  paymentId: string
  entryId: string
  issuedAt: string
  issuedDate: string // YYYY-MM-DD
  issuer: { name: string; address: string; contactNumber: string; receivedBy: string }
  tenant: { name: string; flatNumber: string; mobileNumber: string; depositAmount: string }
  billingMonth: string // YYYY-MM
  rentDueDay: number
  charges: {
    rentAmount: string
    electricityUnits: string // three places, "75.000"
    electricityRate: string
    electricityAmount: string
    waterAmount: string
  }
  totalDue: string
  totalPaid: string
  outstandingAmount: string
  previousMonthOutstanding: string
  paymentAmount: string
  paidDate: string // YYYY-MM-DD
  paymentNotes: string
}

const MONEY = /^\d+\.\d{2}$/
const UNITS = /^\d+\.\d{3}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH = /^\d{4}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(what: string): never {
  throw new ApiError('invalid-response', `Unexpected ${what} in receipt response`)
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(what)
  return value
}

function text(value: Record<string, unknown>, key: string, { required = false } = {}) {
  const item = value[key]
  if (typeof item !== 'string' || (required && item.trim() === '')) invalid(key)
}

function matches(value: Record<string, unknown>, key: string, pattern: RegExp) {
  const item = value[key]
  if (typeof item !== 'string' || !pattern.test(item)) invalid(key)
}

export function parseReceipt(value: unknown): ReceiptDto {
  const receipt = record(value, 'receipt')
  for (const key of ['id', 'reference', 'paymentId', 'entryId', 'issuedAt']) {
    text(receipt, key, { required: true })
  }
  matches(receipt, 'issuedDate', DATE)
  matches(receipt, 'billingMonth', MONTH)
  matches(receipt, 'paidDate', DATE)
  const day = receipt.rentDueDay
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 31) {
    invalid('rentDueDay')
  }
  for (const key of [
    'totalDue',
    'totalPaid',
    'outstandingAmount',
    'previousMonthOutstanding',
    'paymentAmount',
  ]) {
    matches(receipt, key, MONEY)
  }
  text(receipt, 'paymentNotes')

  const issuer = record(receipt.issuer, 'issuer')
  text(issuer, 'name', { required: true })
  text(issuer, 'address', { required: true })
  text(issuer, 'contactNumber')
  text(issuer, 'receivedBy')

  const tenant = record(receipt.tenant, 'tenant')
  text(tenant, 'name', { required: true })
  text(tenant, 'flatNumber', { required: true })
  text(tenant, 'mobileNumber')
  matches(tenant, 'depositAmount', MONEY)

  const charges = record(receipt.charges, 'charges')
  for (const key of ['rentAmount', 'electricityRate', 'electricityAmount', 'waterAmount']) {
    matches(charges, key, MONEY)
  }
  matches(charges, 'electricityUnits', UNITS)

  return value as ReceiptDto
}

export function toReceipt(dto: ReceiptDto): PaymentReceipt {
  return {
    id: dto.id,
    reference: dto.reference,
    paymentId: dto.paymentId,
    entryId: dto.entryId,
    issuedAt: dto.issuedAt,
    issuedDate: dto.issuedDate,
    issuer: { ...dto.issuer },
    tenant: {
      name: dto.tenant.name,
      flatNumber: dto.tenant.flatNumber,
      mobileNumber: dto.tenant.mobileNumber,
      depositAmount: Number(dto.tenant.depositAmount),
    },
    billingMonth: dto.billingMonth,
    rentDueDay: dto.rentDueDay,
    charges: {
      rentAmount: Number(dto.charges.rentAmount),
      electricityUnits: Number(dto.charges.electricityUnits),
      electricityRate: Number(dto.charges.electricityRate),
      electricityAmount: Number(dto.charges.electricityAmount),
      waterAmount: Number(dto.charges.waterAmount),
    },
    totalDue: Number(dto.totalDue),
    totalPaid: Number(dto.totalPaid),
    outstanding: Number(dto.outstandingAmount),
    previousMonthOutstanding: Number(dto.previousMonthOutstanding),
    paymentAmount: Number(dto.paymentAmount),
    paidDate: dto.paidDate,
    paymentNotes: dto.paymentNotes,
  }
}

// What a receipt_configuration_incomplete refusal says to configure (e.g. "Configure the property
// address before issuing receipts."); null for any other error.
export function receiptConfigurationProblem(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'receipt_configuration_incomplete') return null
  const detail = error.fieldErrors.detail
  return typeof detail === 'string' && detail.trim() !== '' ? detail : null
}

function receiptUrl(propertyId: string, tenancyId: string, entryId: string, paymentId: string) {
  return `${paymentsUrl(propertyId, tenancyId, entryId)}${encodeURIComponent(paymentId)}/receipt/`
}

export const receiptService = {
  // Issues the payment's receipt from Django's saved records, or returns the one it already has
  // (created: false), so retrying after a lost response never issues a second. Errors:
  // 'invalid-request' with code 'receipt_configuration_incomplete' (its message says what to
  // configure); 'forbidden'; 'not-found'.
  async issueReceipt(
    propertyId: string,
    tenancyId: string,
    entryId: string,
    paymentId: string,
  ): Promise<IssuedReceipt> {
    let response
    try {
      response = await api.post(receiptUrl(propertyId, tenancyId, entryId, paymentId), {})
    } catch (error) {
      throw toApiError(error)
    }
    return { receipt: toReceipt(parseReceipt(response.data)), created: response.status === 201 }
  },

  // The payment's issued receipt; 'not-found' if none was issued (this never issues one).
  async getReceipt(
    propertyId: string,
    tenancyId: string,
    entryId: string,
    paymentId: string,
  ): Promise<PaymentReceipt> {
    let data: unknown
    try {
      data = (await api.get(receiptUrl(propertyId, tenancyId, entryId, paymentId))).data
    } catch (error) {
      throw toApiError(error)
    }
    return toReceipt(parseReceipt(data))
  },
}
