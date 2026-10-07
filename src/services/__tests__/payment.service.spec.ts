import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'
import {
  outstandingFromConflict,
  parsePayment,
  paymentService,
  toCreatePaymentDto,
  toPayment,
} from '@/services/payment.service'
import type { PaymentInput } from '@/types/payment'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const PROPERTY_ID = '6f1c2a4e-0000-4000-8000-000000000001'
const TENANCY_ID = '0b9d7a1e-0000-4000-8000-000000000101'
const ENTRY_ID = '5d0c9b2a-0000-4000-8000-000000000201'
const PAYMENTS_URL = `/properties/${PROPERTY_ID}/tenancies/${TENANCY_ID}/entries/${ENTRY_ID}/payments/`
const KEY = '2c4e6a8b-0000-4000-8000-000000000301'

const paymentDto = {
  id: '7e1f3b5d-0000-4000-8000-000000000401',
  entryId: ENTRY_ID,
  amount: '3000.00',
  paidDate: '2026-10-05',
  notes: 'Bank transfer',
  createdAt: '2026-10-05T08:00:00Z',
  receipt: null,
}

const entryDto = {
  id: ENTRY_ID,
  tenancyId: TENANCY_ID,
  billingMonth: '2026-09',
  rentAmount: '15000.00',
  electricityUnits: '75.000',
  electricityRate: '6.00',
  electricityAmount: '450.00',
  waterAmount: '300.00',
  totalDue: '15750.00',
  totalPaid: '13000.00',
  outstandingAmount: '2750.00',
  paymentStatus: 'partially_paid',
  notes: '',
  createdAt: '2026-10-01T06:00:00Z',
}

const input: PaymentInput = {
  entryId: ENTRY_ID,
  amount: 3000,
  paidDate: '2026-10-05',
  notes: 'Bank transfer',
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

describe('parsePayment', () => {
  it('maps the backend’s payment to the app’s', () => {
    expect(toPayment(parsePayment(paymentDto))).toEqual({
      id: paymentDto.id,
      entryId: ENTRY_ID,
      amount: 3000,
      paidDate: '2026-10-05',
      notes: 'Bank transfer',
      createdAt: '2026-10-05T08:00:00Z',
      receipt: null,
    })
  })

  it('maps the receipt issued for it', () => {
    const receipt = { id: 'r-1', reference: 'RCT-r-1' }

    expect(toPayment(parsePayment({ ...paymentDto, receipt })).receipt).toEqual(receipt)
  })

  it.each([
    ['a missing id', { id: undefined }],
    ['an amount as a number', { amount: 3000 }],
    ['an amount with three decimals', { amount: '1.005' }],
    ['a negative amount', { amount: '-1.00' }],
    ['a timestamp as the paid date', { paidDate: '2026-10-05T00:00:00Z' }],
    ['missing notes', { notes: null }],
    ['no receipt field', { receipt: undefined }],
    ['a receipt without a reference', { receipt: { id: 'r-1', reference: '' } }],
  ])('rejects %s', (_, change) => {
    expect(() => parsePayment({ ...paymentDto, ...change })).toThrow(ApiError)
  })
})

describe('toCreatePaymentDto', () => {
  it('sends a decimal string, never balances or the bill', () => {
    expect(toCreatePaymentDto({ ...input, amount: 2750.5 })).toEqual({
      amount: '2750.50',
      paidDate: '2026-10-05',
      notes: 'Bank transfer',
    })
  })
})

describe('outstandingFromConflict', () => {
  it('reads the outstanding amount of an overpayment conflict', () => {
    const error = new ApiError(
      'conflict',
      'x',
      'payment_exceeds_outstanding',
      {},
      {
        outstandingAmount: '2750.00',
      },
    )

    expect(outstandingFromConflict(error)).toBe(2750)
  })

  it('is null for other errors or an unreadable amount', () => {
    expect(
      outstandingFromConflict(new ApiError('conflict', 'x', 'idempotency_conflict')),
    ).toBeNull()
    expect(
      outstandingFromConflict(
        new ApiError('conflict', 'x', 'payment_exceeds_outstanding', {}, { outstandingAmount: 5 }),
      ),
    ).toBeNull()
    expect(outstandingFromConflict(new Error('boom'))).toBeNull()
  })
})

describe('paymentService', () => {
  it('records a payment with its idempotency key and returns the bill’s new balance', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ status: 201, data: { payment: paymentDto, entry: entryDto } })

    const result = await paymentService.recordPayment(PROPERTY_ID, TENANCY_ID, input, KEY)

    expect(post).toHaveBeenCalledWith(PAYMENTS_URL, toCreatePaymentDto(input), {
      headers: { 'Idempotency-Key': KEY },
    })
    expect(result.payment.amount).toBe(3000)
    expect(result.entry).toMatchObject({ totalPaid: 13000, outstanding: 2750 })
    expect(result.replayed).toBe(false)
  })

  it('says when the backend returned a payment already recorded (a retry)', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      status: 200,
      data: { payment: paymentDto, entry: entryDto },
    })

    const result = await paymentService.recordPayment(PROPERTY_ID, TENANCY_ID, input, KEY)

    expect(result.replayed).toBe(true)
  })

  it('reports an overpayment with the outstanding amount', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      httpError(409, { code: 'payment_exceeds_outstanding', outstandingAmount: '2750.00' }),
    )

    const error = await paymentService
      .recordPayment(PROPERTY_ID, TENANCY_ID, input, KEY)
      .catch((e: unknown) => e)

    expect(error).toMatchObject({ kind: 'conflict', code: 'payment_exceeds_outstanding' })
    expect(outstandingFromConflict(error)).toBe(2750)
  })

  it('reports a malformed response as invalid', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      status: 201,
      data: { payment: paymentDto, entry: { ...entryDto, totalPaid: 'lots' } },
    })

    await expect(
      paymentService.recordPayment(PROPERTY_ID, TENANCY_ID, input, KEY),
    ).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('lists the bill’s payments', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: [paymentDto] })

    const payments = await paymentService.getPayments(PROPERTY_ID, TENANCY_ID, ENTRY_ID)

    expect(get).toHaveBeenCalledWith(PAYMENTS_URL)
    expect(payments.map((p) => p.amount)).toEqual([3000])
  })

  it('rejects a list that isn’t an array, and reports a missing bill', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { results: [] } })
    await expect(
      paymentService.getPayments(PROPERTY_ID, TENANCY_ID, ENTRY_ID),
    ).rejects.toMatchObject({ kind: 'invalid-response' })

    vi.spyOn(api, 'get').mockRejectedValueOnce(httpError(404, { detail: 'Not found.' }))
    await expect(
      paymentService.getPayments(PROPERTY_ID, TENANCY_ID, ENTRY_ID),
    ).rejects.toMatchObject({ kind: 'not-found' })
  })
})
