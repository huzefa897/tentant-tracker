import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import {
  parseReceipt,
  receiptConfigurationProblem,
  receiptService,
  toReceipt,
} from '@/services/receipt.service'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const PROPERTY_ID = '6f1c2a4e-0000-4000-8000-000000000001'
const TENANCY_ID = '0b9d7a1e-0000-4000-8000-000000000101'
const ENTRY_ID = '5d0c9b2a-0000-4000-8000-000000000201'
const PAYMENT_ID = '7e1f3b5d-0000-4000-8000-000000000401'
const RECEIPT_URL =
  `/properties/${PROPERTY_ID}/tenancies/${TENANCY_ID}/entries/${ENTRY_ID}` +
  `/payments/${PAYMENT_ID}/receipt/`

const receiptDto = {
  id: '97934f0a-83b2-4da7-8847-e266ac37cbec',
  reference: 'Shaik_Zahid_Ali_202_Rent_September 2026',
  paymentId: PAYMENT_ID,
  entryId: ENTRY_ID,
  issuedAt: '2026-10-06T15:00:00Z',
  issuedDate: '2026-10-06',
  issuer: {
    name: 'Saleem Towers',
    address: '1 Example Road',
    contactNumber: '',
    receivedBy: 'Test Manager',
  },
  tenant: {
    name: 'Shaik Zahid Ali',
    flatNumber: '202',
    mobileNumber: '+918341413827',
    depositAmount: '90000.00',
  },
  billingMonth: '2026-09',
  rentDueDay: 11,
  charges: {
    rentAmount: '15000.00',
    electricityUnits: '75.000',
    electricityRate: '6.00',
    electricityAmount: '450.00',
    waterAmount: '300.00',
  },
  totalDue: '15750.00',
  totalPaid: '3000.00',
  outstandingAmount: '12750.00',
  previousMonthOutstanding: '0.00',
  paymentAmount: '3000.00',
  paidDate: '2026-10-06',
  paymentNotes: 'Bank transfer',
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

describe('parseReceipt', () => {
  it('maps the backend’s snapshot to the app’s receipt, money as numbers', () => {
    expect(toReceipt(parseReceipt(receiptDto))).toEqual({
      id: receiptDto.id,
      reference: receiptDto.reference,
      paymentId: PAYMENT_ID,
      entryId: ENTRY_ID,
      issuedAt: '2026-10-06T15:00:00Z',
      issuedDate: '2026-10-06',
      issuer: {
        name: 'Saleem Towers',
        address: '1 Example Road',
        contactNumber: '',
        receivedBy: 'Test Manager',
      },
      tenant: {
        name: 'Shaik Zahid Ali',
        flatNumber: '202',
        mobileNumber: '+918341413827',
        depositAmount: 90000,
      },
      billingMonth: '2026-09',
      rentDueDay: 11,
      charges: {
        rentAmount: 15000,
        electricityUnits: 75,
        electricityRate: 6,
        electricityAmount: 450,
        waterAmount: 300,
      },
      totalDue: 15750,
      totalPaid: 3000,
      outstanding: 12750,
      previousMonthOutstanding: 0,
      paymentAmount: 3000,
      paidDate: '2026-10-06',
      paymentNotes: 'Bank transfer',
    })
  })

  it.each([
    ['a missing reference', { reference: '' }],
    ['an amount as a number', { paymentAmount: 3000 }],
    ['a billing month as a date', { billingMonth: '2026-09-01' }],
    ['a rent due day of 0', { rentDueDay: 0 }],
    ['no issuer', { issuer: null }],
    ['an issuer without an address', { issuer: { ...receiptDto.issuer, address: ' ' } }],
    ['a tenant without a flat', { tenant: { ...receiptDto.tenant, flatNumber: '' } }],
    ['units with two decimals', { charges: { ...receiptDto.charges, electricityUnits: '75.00' } }],
    ['missing notes', { paymentNotes: undefined }],
  ])('rejects %s', (_, change) => {
    expect(() => parseReceipt({ ...receiptDto, ...change })).toThrow(ApiError)
  })
})

describe('receiptConfigurationProblem', () => {
  it('reads what to configure from the refusal', () => {
    const error = toApiError(
      httpError(400, {
        code: 'receipt_configuration_incomplete',
        detail: 'Configure the property address before issuing receipts.',
      }),
    )

    expect(receiptConfigurationProblem(error)).toBe(
      'Configure the property address before issuing receipts.',
    )
  })

  it('is null for any other error', () => {
    expect(receiptConfigurationProblem(toApiError(httpError(400, { detail: 'x' })))).toBeNull()
    expect(receiptConfigurationProblem(new Error('x'))).toBeNull()
  })
})

describe('receiptService', () => {
  it('issues a receipt with an empty body', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 201, data: receiptDto })

    const result = await receiptService.issueReceipt(PROPERTY_ID, TENANCY_ID, ENTRY_ID, PAYMENT_ID)

    expect(post).toHaveBeenCalledWith(RECEIPT_URL, {})
    expect(result.created).toBe(true)
    expect(result.receipt.paymentAmount).toBe(3000)
  })

  it('says when the payment already had this receipt', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ status: 200, data: receiptDto })

    const result = await receiptService.issueReceipt(PROPERTY_ID, TENANCY_ID, ENTRY_ID, PAYMENT_ID)

    expect(result.created).toBe(false)
  })

  it('reports a malformed receipt as invalid', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ status: 201, data: { ...receiptDto, totalDue: 'x' } })

    await expect(
      receiptService.issueReceipt(PROPERTY_ID, TENANCY_ID, ENTRY_ID, PAYMENT_ID),
    ).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('gets an issued receipt, and reports one never issued as not found', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce({ data: receiptDto })

    const receipt = await receiptService.getReceipt(PROPERTY_ID, TENANCY_ID, ENTRY_ID, PAYMENT_ID)

    expect(get).toHaveBeenCalledWith(RECEIPT_URL)
    expect(receipt.reference).toBe(receiptDto.reference)

    get.mockRejectedValueOnce(httpError(404, { detail: 'Not found.' }))
    await expect(
      receiptService.getReceipt(PROPERTY_ID, TENANCY_ID, ENTRY_ID, PAYMENT_ID),
    ).rejects.toMatchObject({ kind: 'not-found' })
  })
})
