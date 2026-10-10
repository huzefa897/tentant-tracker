import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService } from '@/services/access.service'
import { flushPromises } from '@vue/test-utils'

import { ApiError } from '@/services/apiError'
import { paymentService } from '@/services/payment.service'
import { receiptService } from '@/services/receipt.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import {
  CORRECTION_KEY_CONFLICT_MESSAGE,
  CORRECTION_UNCONFIRMED_MESSAGE,
  DUPLICATE_ENTRY_MESSAGE,
  ENTRIES_LOAD_ERROR_MESSAGE,
  ENTRY_ALREADY_VOID_MESSAGE,
  EntryCorrectionError,
  ENTRY_KEY_CONFLICT_MESSAGE,
  EntrySaveError,
  PAYMENT_KEY_CONFLICT_MESSAGE,
  PAYMENT_UNCONFIRMED_MESSAGE,
  PaymentReversalError,
  PaymentSaveError,
  RECEIPT_ERROR_MESSAGE,
  REVERSAL_CONFLICT_MESSAGE,
  REVERSAL_UNCONFIRMED_MESSAGE,
  RECEIPT_UNCONFIRMED_MESSAGE,
  ReceiptError,
  SAVE_UNCONFIRMED_MESSAGE,
  UNREVERSED_PAYMENTS_MESSAGE,
  VOID_CONFLICT_MESSAGE,
  VOID_UNCONFIRMED_MESSAGE,
  useRentEntryStore,
} from '@/stores/rentEntry'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { REVERSED_BY } from '@/test/mocks/paymentService'
import { fakeReceipts } from '@/test/mocks/receiptService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { makeEntry, makePayment } from '@/test/rentEntries'
import type { PaymentInput } from '@/types/payment'
import type {
  EntryCorrectionInput,
  NewRentEntrySubmission,
  RentEntryInput,
  RentEntryPage,
} from '@/types/rentEntry'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
vi.mock('@/services/receipt.service', () => import('@/test/mocks/receiptService'))

const createEntry = vi.mocked(rentEntryService.createEntry)
const getEntries = vi.mocked(rentEntryService.getEntries)
const getEntry = vi.mocked(rentEntryService.getEntry)
const recordPayment = vi.mocked(paymentService.recordPayment)
const getPayments = vi.mocked(paymentService.getPayments)

// The fakes' own implementations, for a test that saves on the "server" and then loses the
// response.
const fakeCreate = createEntry.getMockImplementation()!
const fakeRecord = recordPayment.getMockImplementation()!

const KEY = '2c4e6a8b-0000-4000-8000-000000000301'

const annex = { id: '6f1c2a4e-0000-4000-8000-000000000002', name: 'Annex', role: 'owner' as const }

// Total due: 15000 + 75 × 6 + 300 = 15750
const input: RentEntryInput = {
  tenantId: 'tenant-001',
  billingMonth: '2026-10',
  rentAmount: 15000,
  electricityUnits: 75,
  electricityRate: 6,
  waterAmount: 300,
  notes: 'October charges',
}

function submission(entry: Partial<RentEntryInput> = {}): NewRentEntrySubmission {
  return { entry: { ...input, ...entry }, initialPayment: null }
}

function withInitialPayment(amount: number): NewRentEntrySubmission {
  return { ...submission(), initialPayment: { amount, paidDate: '2026-10-05', notes: '' } }
}

const october = makeEntry({ id: 'oct', billingMonth: '2026-10' })
const september = makeEntry({ id: 'sep', billingMonth: '2026-09' })
const lastYear = makeEntry({ id: 'dec', billingMonth: '2025-12' })
const otherTenant = makeEntry({ id: 'other', tenantId: 'tenant-002', billingMonth: '2026-10' })

// Signed in, with the test property selected (one property: selected automatically).
async function withProperty(properties = [testProperty]) {
  vi.mocked(accessService.getMe).mockResolvedValue(identityWith(properties))
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
  if (properties.length > 1) useAccessStore().selectProperty(properties[0]!.id)
  return useRentEntryStore()
}

// A request the test answers itself, to control the order responses arrive in.
function deferred() {
  let resolve!: (page: RentEntryPage) => void
  const promise = new Promise<RentEntryPage>((r) => (resolve = r))
  return { promise, resolve }
}

async function saveError(promise: Promise<unknown>): Promise<EntrySaveError> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  )
  expect(error).toBeInstanceOf(EntrySaveError)
  return error as EntrySaveError
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetAuthService()
  resetAccessService()
  resetRentEntryService()
  fakeEntries.entries = [october, september, lastYear, otherTenant]
})

describe('loadHistory', () => {
  it('loads one page of the tenant’s bills, newest first, through the selected property', async () => {
    const store = await withProperty()

    await store.loadHistory('tenant-001', {})

    expect(getEntries).toHaveBeenCalledWith(testProperty.id, 'tenant-001', {
      billStatus: 'active',
      year: undefined,
      page: 1,
    })
    expect(store.history).toMatchObject({
      tenantId: 'tenant-001',
      status: 'ready',
      count: 3,
      hasNext: false,
      hasPrevious: false,
    })
    expect(store.history.entries.map((entry) => entry.id)).toEqual(['oct', 'sep', 'dec'])
  })

  it('filters by year and asks for pages by number', async () => {
    fakeEntries.pageSize = 1
    const store = await withProperty()

    await store.loadHistory('tenant-001', { year: '2026', page: 2 })

    expect(store.history).toMatchObject({ year: '2026', page: 2, count: 2, hasPrevious: true })
    expect(store.history.entries.map((entry) => entry.id)).toEqual(['sep'])
  })

  it('reports a failed load as an error, never as an empty history', async () => {
    const store = await withProperty()
    getEntries.mockRejectedValueOnce(new ApiError('unknown'))

    await store.loadHistory('tenant-001', {})

    expect(store.history).toMatchObject({
      status: 'error',
      error: ENTRIES_LOAD_ERROR_MESSAGE,
      entries: [],
    })
  })

  it('explains an unreachable server', async () => {
    const store = await withProperty()
    getEntries.mockRejectedValueOnce(new ApiError('network'))

    await store.loadHistory('tenant-001', {})

    expect(store.history.error).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    )
  })

  it('ignores a slower, older request', async () => {
    const store = await withProperty()
    const slow = deferred()
    getEntries.mockReturnValueOnce(slow.promise)

    const first = store.loadHistory('tenant-001', { year: '2025' })
    await store.loadHistory('tenant-001', { year: '2026' })
    slow.resolve({ entries: [lastYear], count: 1, page: 1, hasNext: false, hasPrevious: false })
    await first

    expect(store.history.year).toBe('2026')
    expect(store.history.entries.map((entry) => entry.id)).toEqual(['oct', 'sep'])
  })

  it('counts the void bills hidden from an empty, unfiltered history', async () => {
    fakeEntries.entries = [
      { ...october, billStatus: 'void' },
      { ...september, billStatus: 'void' },
    ]
    const store = await withProperty()

    await store.loadHistory('tenant-001', {})

    expect(getEntries).toHaveBeenLastCalledWith(testProperty.id, 'tenant-001', {
      billStatus: 'void',
    })
    expect(store.history).toMatchObject({ status: 'ready', count: 0, hiddenVoidCount: 2 })
  })

  it('doesn’t count void bills when the history has bills or is filtered', async () => {
    fakeEntries.entries = [october, { ...september, billStatus: 'void' }]
    const store = await withProperty()

    await store.loadHistory('tenant-001', {})
    await store.loadHistory('tenant-001', { year: '2025' })

    expect(getEntries).toHaveBeenCalledTimes(2)
    expect(store.history).toMatchObject({ count: 0, hiddenVoidCount: 0 })
  })

  it('reports a failed void count as an error, never as an empty history', async () => {
    fakeEntries.entries = [{ ...october, billStatus: 'void' }]
    const store = await withProperty()
    getEntries
      .mockResolvedValueOnce({ entries: [], count: 0, page: 1, hasNext: false, hasPrevious: false })
      .mockRejectedValueOnce(new ApiError('unknown'))

    await store.loadHistory('tenant-001', {})

    expect(store.history).toMatchObject({ status: 'error', error: ENTRIES_LOAD_ERROR_MESSAGE })
  })

  it('does nothing without a selected property', async () => {
    const store = useRentEntryStore()

    await store.loadHistory('tenant-001', {})

    expect(getEntries).not.toHaveBeenCalled()
    expect(store.history.status).toBe('idle')
  })
})

describe('loadSummary', () => {
  it('ignores a slower, older summary for the same tenant', async () => {
    const store = await withProperty()
    const slow = deferred()
    getEntries.mockReturnValueOnce(slow.promise)

    const first = store.loadSummary('tenant-001')
    await store.loadSummary('tenant-001')
    slow.resolve({ entries: [lastYear], count: 1, page: 1, hasNext: false, hasPrevious: false })
    await first

    expect(store.summaries['tenant-001']).toMatchObject({ status: 'ready', count: 3 })
    expect(store.summaries['tenant-001']!.latest?.id).toBe('oct')
  })

  it('discards a summary that was in flight when a bill was saved', async () => {
    fakeEntries.entries = [september]
    const store = await withProperty()
    const slow = deferred()
    getEntries.mockReturnValueOnce(slow.promise)

    const pending = store.loadSummary('tenant-001')
    await store.addEntry({ entry: { ...input }, initialPayment: null }, KEY)
    // The response from before the save: one bill, September.
    slow.resolve({ entries: [september], count: 1, page: 1, hasNext: false, hasPrevious: false })
    await pending

    expect(store.summaries['tenant-001']).toBeUndefined()

    await store.loadSummary('tenant-001')
    expect(store.summaries['tenant-001']).toMatchObject({ count: 2 })
    expect(store.summaries['tenant-001']!.latest?.billingMonth).toBe('2026-10')
  })

  it('keeps summaries of different tenants independent', async () => {
    const store = await withProperty()
    const slow = deferred()
    getEntries.mockReturnValueOnce(slow.promise)

    const first = store.loadSummary('tenant-001')
    await store.loadSummary('tenant-002')
    slow.resolve({ entries: [october], count: 3, page: 1, hasNext: false, hasPrevious: false })
    await first

    expect(store.summaries['tenant-001']).toMatchObject({ status: 'ready', count: 3 })
    expect(store.summaries['tenant-002']).toMatchObject({ status: 'ready', count: 1 })
  })

  it('keeps the tenant’s newest bill and bill count', async () => {
    const store = await withProperty()

    await store.loadSummary('tenant-001')

    expect(store.summaries['tenant-001']).toMatchObject({ status: 'ready', count: 3, error: null })
    expect(store.summaries['tenant-001']!.latest?.id).toBe('oct')
  })

  it('has no latest bill for a tenant without any', async () => {
    const store = await withProperty()

    await store.loadSummary('tenant-003')

    expect(store.summaries['tenant-003']).toMatchObject({ status: 'ready', latest: null, count: 0 })
  })

  it('reports a failure as an error, never as no bills', async () => {
    const store = await withProperty()
    getEntries.mockRejectedValueOnce(new ApiError('unavailable'))

    await store.loadSummary('tenant-001')

    expect(store.summaries['tenant-001']).toMatchObject({
      status: 'error',
      latest: null,
      error: 'Rent entries are unavailable right now. Please try again shortly.',
    })
  })

  it('asks to wait when requests are rate limited', async () => {
    const store = await withProperty()
    getEntries.mockRejectedValueOnce(new ApiError('rate-limited'))

    await store.loadSummary('tenant-001')

    expect(store.summaries['tenant-001']?.error).toBe(
      'Too many requests. Wait a minute and try again.',
    )
  })
})

describe('loadEntry', () => {
  it('loads a bill by URL and keeps it', async () => {
    const store = await withProperty()

    expect(await store.loadEntry('tenant-001', 'sep')).toEqual(september)
    expect(getEntry).toHaveBeenCalledWith(testProperty.id, 'tenant-001', 'sep')
    expect(store.getEntry('tenant-001', 'sep')).toEqual(september)
  })

  it('reuses a bill already loaded', async () => {
    const store = await withProperty()
    await store.loadHistory('tenant-001', {})

    expect(await store.loadEntry('tenant-001', 'oct')).toEqual(october)
    expect(getEntry).not.toHaveBeenCalled()
  })

  it('never returns a bill under another tenant', async () => {
    const store = await withProperty()
    await store.loadSummary('tenant-002')

    expect(store.getEntry('tenant-001', 'other')).toBeNull()
    expect(await store.loadEntry('tenant-001', 'other')).toBeNull()
  })

  it('returns null for a missing bill but throws other failures', async () => {
    const store = await withProperty()

    expect(await store.loadEntry('tenant-001', 'missing')).toBeNull()

    getEntry.mockRejectedValueOnce(new ApiError('network'))
    await expect(store.loadEntry('tenant-001', 'sep')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('addEntry', () => {
  beforeEach(() => {
    fakeEntries.entries = [september]
  })

  it('saves through the API with its idempotency key and returns the backend’s bill', async () => {
    const store = await withProperty()

    const entry = await store.addEntry(submission(), KEY)

    expect(createEntry).toHaveBeenCalledWith(testProperty.id, 'tenant-001', submission(), KEY)
    expect(entry).toMatchObject({ billingMonth: '2026-10', totalDue: 15750, status: 'unpaid' })
    expect(store.getEntry('tenant-001', entry.id)).toEqual(entry)
  })

  it('saves a payment received with the bill, and shows the backend’s balance', async () => {
    const store = await withProperty()

    const entry = await store.addEntry(withInitialPayment(10000), KEY)

    expect(entry).toMatchObject({ totalPaid: 10000, outstanding: 5750, status: 'partially_paid' })
    expect(fakeEntries.payments).toHaveLength(1)
  })

  it('returns the backend’s figures, not the preview’s', async () => {
    fakeEntries.rate = 7
    const store = await withProperty()

    const entry = await store.addEntry(submission(), KEY)

    expect(entry).toMatchObject({ electricityRate: 7, electricityAmount: 525, totalDue: 15825 })
  })

  it('drops the tenant’s summary so the dashboard reloads it', async () => {
    const store = await withProperty()
    await store.loadSummary('tenant-001')

    await store.addEntry(submission(), KEY)

    expect(store.summaries['tenant-001']).toBeUndefined()
  })

  it('refuses an invalid entry or payment without calling the API', async () => {
    const store = await withProperty()

    for (const invalid of [
      submission({ rentAmount: 0 }),
      {
        ...withInitialPayment(10000),
        initialPayment: { amount: 1.005, paidDate: '2026-10-05', notes: '' },
      },
      { ...withInitialPayment(10000), initialPayment: { amount: 100, paidDate: '', notes: '' } },
    ]) {
      const error = await saveError(store.addEntry(invalid, KEY))
      expect(error.message).toBe('This entry is not valid. Check the form and try again.')
    }
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('reports a duplicate month with the bill already saved for it', async () => {
    const store = await withProperty()

    const error = await saveError(store.addEntry(submission({ billingMonth: '2026-09' }), KEY))

    expect(error.message).toBe(DUPLICATE_ENTRY_MESSAGE)
    expect(error.existingEntry?.id).toBe('sep')
    expect(error.uncertain).toBe(false)
    expect(fakeEntries.entries).toHaveLength(1)
  })

  it('shows the backend’s reason for a rejected field', async () => {
    const store = await withProperty()
    createEntry.mockRejectedValueOnce(
      new ApiError('invalid-request', 'Bad request', null, {
        billingMonth: "This month is outside the tenancy's occupancy period.",
      }),
    )

    const error = await saveError(store.addEntry(submission(), KEY))

    expect(error.message).toBe("This month is outside the tenancy's occupancy period.")
  })

  it('explains a payment more than the bill the backend calculated', async () => {
    // The rate went down while the form was open: ₹15,375 due, not the ₹15,750 previewed.
    fakeEntries.rate = 1
    const store = await withProperty()

    const error = await saveError(store.addEntry(withInitialPayment(15750), KEY))

    expect(error.message).toBe(
      "The payment is more than the bill's total due of ₹15,375. Check the amount and try again.",
    )
    expect(fakeEntries.entries).toHaveLength(1)
  })

  it('marks a save with no response as uncertain, and its retry returns the saved bill', async () => {
    const store = await withProperty()
    // Saved on the server, but the response never arrived.
    createEntry.mockImplementationOnce(async (...args: Parameters<typeof createEntry>) => {
      await fakeCreate(...args)
      throw new ApiError('network')
    })

    const error = await saveError(store.addEntry(withInitialPayment(10000), KEY))
    expect(error).toMatchObject({ message: SAVE_UNCONFIRMED_MESSAGE, uncertain: true })

    const entry = await store.addEntry(withInitialPayment(10000), KEY)

    expect(entry.totalPaid).toBe(10000)
    expect(fakeEntries.entries.filter((e) => e.billingMonth === '2026-10')).toHaveLength(1)
    expect(fakeEntries.payments).toHaveLength(1)
  })

  it('treats server errors and unreadable responses as uncertain too', async () => {
    const store = await withProperty()

    for (const kind of ['unavailable', 'invalid-response'] as const) {
      createEntry.mockRejectedValueOnce(new ApiError(kind))
      const error = await saveError(store.addEntry(submission(), KEY))
      expect(error.uncertain).toBe(true)
    }
  })

  it('links the bill an earlier attempt with this key saved with other details', async () => {
    const store = await withProperty()
    await store.addEntry(submission(), KEY)

    const error = await saveError(store.addEntry(submission({ waterAmount: 400 }), KEY))

    expect(error.message).toBe(ENTRY_KEY_CONFLICT_MESSAGE)
    expect(error.existingEntry?.billingMonth).toBe('2026-10')
    expect(error.uncertain).toBe(false)
  })

  it('asks to wait when rate limited, without checking for a saved bill', async () => {
    const store = await withProperty()
    createEntry.mockRejectedValueOnce(new ApiError('rate-limited'))

    const error = await saveError(store.addEntry(submission(), KEY))

    expect(error.message).toBe(
      'Too many requests. Wait a minute and try again. Your form has been kept.',
    )
    expect(error.existingEntry).toBeNull()
    expect(getEntries).not.toHaveBeenCalled()
  })

  it('explains a refusal to save', async () => {
    const store = await withProperty()
    createEntry.mockRejectedValueOnce(new ApiError('forbidden'))

    const error = await saveError(store.addEntry(submission(), KEY))

    expect(error.message).toBe("You don't have permission to add entries for this property.")
  })

  it('needs a selected property', async () => {
    const store = useRentEntryStore()

    await expect(store.addEntry(submission(), KEY)).rejects.toThrow('Choose a property first.')
    expect(createEntry).not.toHaveBeenCalled()
  })
})

describe('payments', () => {
  // September: ₹15,750 due, ₹10,000 already paid.
  beforeEach(() => {
    fakeEntries.entries = [september]
    addFakePayment(makePayment({ id: 'p-1', entryId: 'sep', amount: 10000 }))
  })

  const payment = (amount: number, notes = ''): PaymentInput => ({
    entryId: 'sep',
    amount,
    paidDate: '2026-10-05',
    notes,
  })

  async function paymentError(promise: Promise<unknown>): Promise<PaymentSaveError> {
    const error = await promise.then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(PaymentSaveError)
    return error as PaymentSaveError
  }

  it('loads a bill’s payments, newest first', async () => {
    addFakePayment(makePayment({ id: 'p-2', entryId: 'sep', amount: 500, paidDate: '2026-10-06' }))
    const store = await withProperty()

    await store.loadPayments('tenant-001', 'sep')

    expect(getPayments).toHaveBeenCalledWith(testProperty.id, 'tenant-001', 'sep')
    expect(store.payments.sep).toMatchObject({ status: 'ready', error: null })
    expect(store.payments.sep!.payments.map((p) => p.id)).toEqual(['p-2', 'p-1'])
  })

  it('reports a failed load as an error, never as no payments', async () => {
    const store = await withProperty()
    getPayments.mockRejectedValueOnce(new ApiError('unavailable'))

    await store.loadPayments('tenant-001', 'sep')

    expect(store.payments.sep).toMatchObject({
      status: 'error',
      payments: [],
      error: 'Payments are unavailable right now. Please try again shortly.',
    })
  })

  it('asks to wait when loading payments is rate limited', async () => {
    const store = await withProperty()
    getPayments.mockRejectedValueOnce(new ApiError('rate-limited'))

    await store.loadPayments('tenant-001', 'sep')

    expect(store.payments.sep?.error).toBe('Too many requests. Wait a minute and try again.')
  })

  it('records a payment and shows the backend’s new balance everywhere', async () => {
    const store = await withProperty()
    await store.loadHistory('tenant-001', {})
    await store.loadSummary('tenant-001')

    const recorded = await store.addPayment('tenant-001', payment(3000), KEY)

    expect(recordPayment).toHaveBeenCalledWith(testProperty.id, 'tenant-001', payment(3000), KEY)
    expect(recorded).toMatchObject({ replayed: false, payment: { amount: 3000 } })
    expect(recorded.entry).toMatchObject({ totalPaid: 13000, outstanding: 2750 })
    expect(store.getEntry('tenant-001', 'sep')?.outstanding).toBe(2750)
    expect(store.history.entries[0]?.outstanding).toBe(2750)
    expect(store.summaries['tenant-001']?.latest?.outstanding).toBe(2750)
  })

  it('reloads the payment history after a payment', async () => {
    const store = await withProperty()

    await store.addPayment('tenant-001', payment(3000), KEY)
    await flushPromises()

    expect(store.payments.sep!.payments.map((p) => p.amount)).toEqual([3000, 10000])
  })

  it('settles the bill with the outstanding amount', async () => {
    const store = await withProperty()

    const { entry } = await store.addPayment('tenant-001', payment(5750), KEY)

    expect(entry.status).toBe('paid')
  })

  it('refuses more than the outstanding amount, says what it is and refreshes it', async () => {
    const store = await withProperty()
    await store.loadEntry('tenant-001', 'sep')
    // Someone else paid ₹3,000 meanwhile: ₹2,750 is left.
    addFakePayment(makePayment({ id: 'p-other', entryId: 'sep', amount: 3000 }))

    const error = await paymentError(store.addPayment('tenant-001', payment(5750), KEY))
    await flushPromises()

    expect(error).toMatchObject({
      message: 'Amount cannot exceed the outstanding ₹2,750.',
      uncertain: false,
    })
    expect(fakeEntries.payments).toHaveLength(2)
    expect(store.getEntry('tenant-001', 'sep')?.outstanding).toBe(2750)
  })

  it('says a fully paid bill takes no more payments', async () => {
    addFakePayment(makePayment({ id: 'p-2', entryId: 'sep', amount: 5750 }))
    const store = await withProperty()

    const error = await paymentError(store.addPayment('tenant-001', payment(1), KEY))

    expect(error.message).toBe('This bill is already fully paid.')
  })

  it('marks a payment with no response as uncertain; its retry records the money once', async () => {
    const store = await withProperty()
    // Recorded on the server, but the response never arrived.
    recordPayment.mockImplementationOnce(async (...args: Parameters<typeof recordPayment>) => {
      await fakeRecord(...args)
      throw new ApiError('network')
    })

    const error = await paymentError(store.addPayment('tenant-001', payment(3000), KEY))
    expect(error).toMatchObject({ message: PAYMENT_UNCONFIRMED_MESSAGE, uncertain: true })

    const retry = await store.addPayment('tenant-001', payment(3000), KEY)

    expect(retry.replayed).toBe(true)
    expect(retry.entry.totalPaid).toBe(13000)
    expect(fakeEntries.payments).toHaveLength(2)
  })

  it('retries the payment that settled the bill successfully', async () => {
    const store = await withProperty()
    await store.addPayment('tenant-001', payment(5750), KEY)

    const retry = await store.addPayment('tenant-001', payment(5750), KEY)

    expect(retry).toMatchObject({ replayed: true, entry: { status: 'paid' } })
  })

  it('says when an earlier attempt with this key was recorded with other details', async () => {
    const store = await withProperty()
    await store.addPayment('tenant-001', payment(3000), KEY)

    const error = await paymentError(store.addPayment('tenant-001', payment(3000, 'Cash'), KEY))

    expect(error).toMatchObject({ message: PAYMENT_KEY_CONFLICT_MESSAGE, uncertain: false })
    expect(fakeEntries.payments).toHaveLength(2)
  })

  it('shows the backend’s reason for a rejected field', async () => {
    const store = await withProperty()
    recordPayment.mockRejectedValueOnce(
      new ApiError('invalid-request', 'Bad request', null, {
        paidDate: "The paid date can't be in the future.",
      }),
    )

    const error = await paymentError(store.addPayment('tenant-001', payment(3000), KEY))

    expect(error).toMatchObject({
      message: "The paid date can't be in the future.",
      uncertain: false,
    })
  })

  it('asks to wait when rate limited; nothing was recorded, so it isn’t uncertain', async () => {
    const store = await withProperty()
    recordPayment.mockRejectedValueOnce(new ApiError('rate-limited'))

    const error = await paymentError(store.addPayment('tenant-001', payment(3000), KEY))

    expect(error).toMatchObject({
      message:
        'Too many requests. Wait a minute and try again. Your payment details have been kept.',
      uncertain: false,
    })
  })

  it('refuses an invalid payment without calling the API', async () => {
    const store = await withProperty()

    const error = await paymentError(store.addPayment('tenant-001', payment(0), KEY))

    expect(error.message).toBe('This payment is not valid. Check the form and try again.')
    expect(recordPayment).not.toHaveBeenCalled()
  })

  it('forgets payments when the property changes', async () => {
    const store = await withProperty([testProperty, annex])
    await store.loadPayments('tenant-001', 'sep')

    useAccessStore().selectProperty(annex.id)

    expect(store.payments).toEqual({})
  })

  it('keeps one pending payment key per bill until it is forgotten', async () => {
    const store = await withProperty()

    const key = store.paymentKeyFor('sep')
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(store.paymentKeyFor('sep')).toBe(key)
    expect(store.paymentKeyFor('oct')).not.toBe(key)

    store.forgetPaymentKey('sep')
    expect(store.paymentKeyFor('sep')).not.toBe(key)
  })

  it('forgets pending payment keys when the property changes', async () => {
    const store = await withProperty([testProperty, annex])
    const key = store.paymentKeyFor('sep')

    useAccessStore().selectProperty(annex.id)

    expect(store.paymentKeyFor('sep')).not.toBe(key)
  })
})

describe('receipts', () => {
  const issueReceipt = vi.mocked(receiptService.issueReceipt)
  const getReceipt = vi.mocked(receiptService.getReceipt)

  beforeEach(() => {
    fakeEntries.entries = [september]
    addFakePayment(makePayment({ id: 'p-1', entryId: 'sep', amount: 3000 }))
  })

  async function receiptError(promise: Promise<unknown>): Promise<ReceiptError> {
    const error = await promise.then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(ReceiptError)
    return error as ReceiptError
  }

  it('issues a payment’s first receipt and shows the payment has one', async () => {
    const store = await withProperty()
    await store.loadPayments('tenant-001', 'sep')
    const payment = store.payments.sep!.payments[0]!

    const receipt = await store.getReceipt('tenant-001', payment)

    expect(issueReceipt).toHaveBeenCalledWith(testProperty.id, 'tenant-001', 'sep', 'p-1')
    expect(receipt).toMatchObject({ paymentId: 'p-1', paymentAmount: 3000 })
    expect(store.payments.sep!.payments[0]!.receipt).toEqual({
      id: receipt.id,
      reference: receipt.reference,
      status: 'issued',
    })
  })

  it('loads an issued receipt without issuing another, every time it’s asked for', async () => {
    const store = await withProperty()
    await store.loadPayments('tenant-001', 'sep')
    await store.getReceipt('tenant-001', store.payments.sep!.payments[0]!)
    // As on another visit: nothing cached, the payment shows it has a receipt.
    store.reset()
    await store.loadPayments('tenant-001', 'sep')
    const payment = store.payments.sep!.payments[0]!
    issueReceipt.mockClear()

    const receipt = await store.getReceipt('tenant-001', payment)
    await store.getReceipt('tenant-001', payment)

    expect(issueReceipt).not.toHaveBeenCalled()
    // Never reused: its payment may have been reversed since, voiding it.
    expect(getReceipt).toHaveBeenCalledTimes(2)
    expect(receipt).toBe(fakeReceipts.get('p-1'))
  })

  it('reports what to configure when the backend refuses to issue', async () => {
    const store = await withProperty()
    issueReceipt.mockRejectedValueOnce(
      new ApiError('invalid-request', 'x', 'receipt_configuration_incomplete', {
        detail: 'Configure the property address before issuing receipts.',
      }),
    )

    const error = await receiptError(
      store.getReceipt('tenant-001', makePayment({ id: 'p-1', entryId: 'sep' })),
    )

    expect(error.message).toBe('Configure the property address before issuing receipts.')
    expect(error.uncertain).toBe(false)
  })

  it('says a lost response is safe to retry, and the retry returns the same receipt', async () => {
    const store = await withProperty()
    const issue = issueReceipt.getMockImplementation()!
    // Issued on the server, but the response was lost.
    issueReceipt.mockImplementationOnce(async (...args) => {
      await issue(...args)
      throw new ApiError('network')
    })
    const payment = makePayment({ id: 'p-1', entryId: 'sep' })

    const error = await receiptError(store.getReceipt('tenant-001', payment))
    expect(error).toMatchObject({ message: RECEIPT_UNCONFIRMED_MESSAGE, uncertain: true })

    const receipt = await store.getReceipt('tenant-001', payment)
    expect(receipt).toBe(fakeReceipts.get('p-1'))
    expect(fakeReceipts.size).toBe(1)
  })

  it('says only to try again when an issued receipt fails to load', async () => {
    const store = await withProperty()
    getReceipt.mockRejectedValueOnce(new ApiError('network'))
    const payment = makePayment({
      id: 'p-1',
      entryId: 'sep',
      receipt: {
        id: 'r-1',
        reference: 'Shaik_Zahid_Ali_202_Rent_September 2026',
        status: 'issued',
      },
    })

    const error = await receiptError(store.getReceipt('tenant-001', payment))

    expect(error).toMatchObject({ message: RECEIPT_ERROR_MESSAGE, uncertain: false })
    expect(issueReceipt).not.toHaveBeenCalled()
  })

  it('never changes the payment when a receipt fails', async () => {
    const store = await withProperty()
    await store.loadPayments('tenant-001', 'sep')
    const before = store.payments.sep
    issueReceipt.mockRejectedValueOnce(new ApiError('forbidden'))

    const error = await receiptError(store.getReceipt('tenant-001', before!.payments[0]!))

    expect(error.message).toBe("You don't have permission to issue receipts for this property.")
    expect(store.payments.sep).toEqual(before)
    expect(recordPayment).not.toHaveBeenCalled()
  })

  it('gets the receipt for a bill’s most recent payment, loading its payments', async () => {
    addFakePayment(makePayment({ id: 'p-2', entryId: 'sep', amount: 500, paidDate: '2026-10-06' }))
    const store = await withProperty()

    const receipt = await store.getLatestReceipt('tenant-001', 'sep')

    expect(receipt.paymentId).toBe('p-2')
    expect(store.payments.sep!.payments[0]).toMatchObject({
      id: 'p-2',
      receipt: { id: receipt.id, reference: receipt.reference },
    })
  })

  it('reloads the bill’s payments for its latest receipt, never a loaded list', async () => {
    const store = await withProperty()
    await store.loadPayments('tenant-001', 'sep')
    const cached = store.payments.sep!.payments[0]!
    // Someone else records a newer payment after the list loaded.
    addFakePayment(makePayment({ id: 'p-2', entryId: 'sep', amount: 500, paidDate: '2026-10-06' }))

    const receipt = await store.getLatestReceipt('tenant-001', 'sep')

    expect(receipt.paymentId).toBe('p-2')
    expect(fakeReceipts.has(cached.id)).toBe(false)
    expect(store.payments.sep!.payments.map((payment) => payment.id)).toEqual(['p-2', cached.id])
  })

  it('never falls back to a loaded list when the payments fail to reload', async () => {
    const store = await withProperty()
    await store.loadPayments('tenant-001', 'sep')
    const before = store.payments.sep
    getPayments.mockRejectedValueOnce(new ApiError('network'))

    const error = await receiptError(store.getLatestReceipt('tenant-001', 'sep'))

    expect(error.message).toBe(RECEIPT_ERROR_MESSAGE)
    expect(issueReceipt).not.toHaveBeenCalled()
    expect(store.payments.sep).toEqual(before)
  })

  it('supersedes a payments load already under way', async () => {
    const store = await withProperty()
    const list = getPayments.getMockImplementation()!
    let finishStale!: () => void
    getPayments.mockImplementationOnce(async (...args) => {
      const stale = await list(...args)
      await new Promise<void>((resolve) => (finishStale = resolve))
      return stale
    })
    const loading = store.loadPayments('tenant-001', 'sep')
    addFakePayment(makePayment({ id: 'p-2', entryId: 'sep', amount: 500, paidDate: '2026-10-06' }))

    await store.getLatestReceipt('tenant-001', 'sep')
    finishStale()
    await loading

    expect(store.payments.sep!.status).toBe('ready')
    expect(store.payments.sep!.payments[0]!.id).toBe('p-2')
  })

  it('says a bill without payments has no receipt', async () => {
    fakeEntries.entries = [october]
    const store = await withProperty()

    const error = await receiptError(store.getLatestReceipt('tenant-001', 'oct'))

    expect(error.message).toBe('No payments have been recorded for this entry yet.')
    expect(issueReceipt).not.toHaveBeenCalled()
  })

  it('reports payments that fail to load as an error', async () => {
    const store = await withProperty()
    getPayments.mockRejectedValueOnce(new ApiError('network'))

    const error = await receiptError(store.getLatestReceipt('tenant-001', 'sep'))

    expect(error.message).toBe(RECEIPT_ERROR_MESSAGE)
    expect(issueReceipt).not.toHaveBeenCalled()
  })

  it('says the entry can’t be found when its payments 404', async () => {
    const store = await withProperty()
    getPayments.mockRejectedValueOnce(new ApiError('not-found'))

    const error = await receiptError(store.getLatestReceipt('tenant-001', 'sep'))

    expect(error.message).toBe("This entry can't be found. It may no longer be available.")
  })

  it('forgets loaded receipts when the property changes', async () => {
    const store = await withProperty([testProperty, annex])
    const payment = makePayment({ id: 'p-1', entryId: 'sep' })
    await store.getReceipt('tenant-001', payment)

    useAccessStore().selectProperty(annex.id)
    useAccessStore().selectProperty(testProperty.id)
    await store.getReceipt('tenant-001', payment)

    expect(issueReceipt).toHaveBeenCalledTimes(2)
  })
})

describe('reversing payments', () => {
  const reversePayment = vi.mocked(paymentService.reversePayment)
  const getReceipt = vi.mocked(receiptService.getReceipt)
  const REASON = 'Entered ₹10,000 instead of ₹1,000.'

  beforeEach(() => {
    // ₹15,750 due, ₹10,000 of it recorded by mistake.
    fakeEntries.entries = [september]
    addFakePayment(makePayment({ id: 'p-1', entryId: 'sep', amount: 10000 }))
  })

  async function loaded() {
    const store = await withProperty()
    await store.loadEntry('tenant-001', 'sep')
    await store.loadPayments('tenant-001', 'sep')
    return store
  }

  async function reversalError(promise: Promise<unknown>): Promise<PaymentReversalError> {
    const error = await promise.then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(PaymentReversalError)
    return error as PaymentReversalError
  }

  it('shows the backend’s balance without the payment, and the payment as reversed', async () => {
    const store = await loaded()
    const payment = store.payments.sep!.payments[0]!

    const result = await store.reversePayment('tenant-001', payment, `  ${REASON} `)

    expect(reversePayment).toHaveBeenCalledWith(testProperty.id, 'tenant-001', payment, REASON)
    expect(result.replayed).toBe(false)
    expect(store.getEntry('tenant-001', 'sep')).toMatchObject({
      totalPaid: 0,
      outstanding: 15750,
      status: 'unpaid',
    })
    await flushPromises()
    expect(store.payments.sep!.payments[0]).toMatchObject({
      id: 'p-1',
      amount: 10000,
      status: 'reversed',
      reversal: { reason: REASON, createdByName: REVERSED_BY },
    })
  })

  it('gets the receipt again once it’s void, rather than the copy from before', async () => {
    const store = await loaded()
    const issued = await store.getReceipt('tenant-001', store.payments.sep!.payments[0]!)
    expect(issued.status).toBe('issued')

    await store.reversePayment('tenant-001', store.payments.sep!.payments[0]!, REASON)
    await flushPromises()
    const receipt = await store.getReceipt('tenant-001', store.payments.sep!.payments[0]!)

    expect(receipt).toMatchObject({ status: 'void', voidReason: REASON, paymentAmount: 10000 })
    expect(store.payments.sep!.payments[0]!.receipt?.status).toBe('void')
  })

  it('gets a receipt voided elsewhere as void, even from a history that predates it', async () => {
    const store = await loaded()
    await store.getReceipt('tenant-001', store.payments.sep!.payments[0]!)
    // Reversed by someone else; this history still says the receipt is issued.
    await paymentService.reversePayment(
      testProperty.id,
      'tenant-001',
      makePayment({ id: 'p-1', entryId: 'sep' }),
      REASON,
    )
    const stale = store.payments.sep!.payments[0]!
    expect(stale.receipt?.status).toBe('issued')

    const receipt = await store.getReceipt('tenant-001', stale)

    expect(receipt).toMatchObject({ status: 'void', voidReason: REASON })
    expect(store.payments.sep!.payments[0]!.receipt?.status).toBe('void')
  })

  it('reuses a void receipt, which never changes again', async () => {
    const store = await loaded()
    await store.getReceipt('tenant-001', store.payments.sep!.payments[0]!)
    await store.reversePayment('tenant-001', store.payments.sep!.payments[0]!, REASON)
    await flushPromises()
    const reversed = store.payments.sep!.payments[0]!
    await store.getReceipt('tenant-001', reversed)
    getReceipt.mockClear()

    const receipt = await store.getReceipt('tenant-001', reversed)

    expect(receipt.status).toBe('void')
    expect(getReceipt).not.toHaveBeenCalled()
  })

  it('reloads the history when the payment was reversed before its receipt was issued', async () => {
    const store = await loaded()
    // Reversed by someone else before any receipt; this history still says it counts.
    await paymentService.reversePayment(
      testProperty.id,
      'tenant-001',
      makePayment({ id: 'p-1', entryId: 'sep' }),
      REASON,
    )

    await expect(store.getReceipt('tenant-001', store.payments.sep!.payments[0]!)).rejects.toThrow(
      'This payment has been reversed, so it has no receipt.',
    )
    await flushPromises()

    expect(store.payments.sep!.payments[0]!.status).toBe('reversed')
    expect(store.getEntry('tenant-001', 'sep')?.totalPaid).toBe(0)
  })

  it('reloads a receipt someone else voided since it was cached', async () => {
    const store = await loaded()
    await store.getReceipt('tenant-001', store.payments.sep!.payments[0]!)
    // Reversed elsewhere: the reloaded history says the receipt is void.
    await paymentService.reversePayment(
      testProperty.id,
      'tenant-001',
      makePayment({ id: 'p-1', entryId: 'sep' }),
      REASON,
    )
    await store.loadPayments('tenant-001', 'sep')

    const receipt = await store.getReceipt('tenant-001', store.payments.sep!.payments[0]!)

    expect(receipt.status).toBe('void')
  })

  it('offers the latest receipt of a payment that still counts', async () => {
    addFakePayment(makePayment({ id: 'p-2', entryId: 'sep', amount: 1000, paidDate: '2026-10-01' }))
    const store = await loaded()
    await store.reversePayment('tenant-001', store.payments.sep!.payments[0]!, REASON)

    const receipt = await store.getLatestReceipt('tenant-001', 'sep')

    expect(receipt.paymentId).toBe('p-2')
  })

  it('says a bill whose payments were all reversed has no receipt', async () => {
    const store = await loaded()
    await store.reversePayment('tenant-001', store.payments.sep!.payments[0]!, REASON)

    await expect(store.getLatestReceipt('tenant-001', 'sep')).rejects.toThrow(
      'No payments have been recorded for this entry yet.',
    )
  })

  it('refuses an empty or long reason without calling the API', async () => {
    const store = await loaded()
    const payment = store.payments.sep!.payments[0]!

    expect((await reversalError(store.reversePayment('tenant-001', payment, '  '))).message).toBe(
      'Say why this payment is being reversed.',
    )
    expect(
      (await reversalError(store.reversePayment('tenant-001', payment, 'x'.repeat(501)))).message,
    ).toBe('The reason must be 500 characters or fewer.')
    expect(reversePayment).not.toHaveBeenCalled()
  })

  it('says a lost response is safe to retry, and the retry reverses it once', async () => {
    const store = await loaded()
    const payment = store.payments.sep!.payments[0]!
    reversePayment.mockImplementationOnce(async (...args) => {
      await vi.mocked(paymentService.reversePayment).getMockImplementation()!(...args)
      throw new ApiError('network')
    })

    const error = await reversalError(store.reversePayment('tenant-001', payment, REASON))

    expect(error).toMatchObject({ message: REVERSAL_UNCONFIRMED_MESSAGE, uncertain: true })
    // Reloaded meanwhile, so the history already shows it went through.
    await flushPromises()
    expect(store.payments.sep!.payments[0]!.status).toBe('reversed')
    expect(store.getEntry('tenant-001', 'sep')?.totalPaid).toBe(0)

    const retried = await store.reversePayment('tenant-001', payment, REASON)
    expect(retried.replayed).toBe(true)
    expect(store.getEntry('tenant-001', 'sep')?.totalPaid).toBe(0)
  })

  it('says when it was already reversed for another reason, and shows that', async () => {
    const store = await loaded()
    const payment = store.payments.sep!.payments[0]!
    await paymentService.reversePayment(testProperty.id, 'tenant-001', payment, 'Wrong bill.')

    const error = await reversalError(store.reversePayment('tenant-001', payment, REASON))
    await flushPromises()

    expect(error).toMatchObject({ message: REVERSAL_CONFLICT_MESSAGE, uncertain: false })
    expect(store.payments.sep!.payments[0]!.reversal?.reason).toBe('Wrong bill.')
    expect(store.getEntry('tenant-001', 'sep')?.totalPaid).toBe(0)
  })

  it('says only owners can reverse when the backend refuses, and changes nothing', async () => {
    const store = await loaded()
    reversePayment.mockRejectedValueOnce(new ApiError('forbidden'))

    const error = await reversalError(
      store.reversePayment('tenant-001', store.payments.sep!.payments[0]!, REASON),
    )

    expect(error.message).toBe("Only the property's owners can reverse payments.")
    expect(store.payments.sep!.payments[0]!.status).toBe('recorded')
    expect(store.getEntry('tenant-001', 'sep')?.totalPaid).toBe(10000)
  })

  it('shows the backend’s reason for a rejected reason', async () => {
    const store = await loaded()
    reversePayment.mockRejectedValueOnce(
      new ApiError('invalid-request', 'x', null, {
        reason: 'The reason must be 500 characters or fewer.',
      }),
    )

    const error = await reversalError(
      store.reversePayment('tenant-001', store.payments.sep!.payments[0]!, REASON),
    )

    expect(error.message).toBe('The reason must be 500 characters or fewer.')
  })

  it('ignores a reversal that answers after the property changed', async () => {
    const annex = { ...testProperty, id: 'property-annex', name: 'Annex' }
    const store = await withProperty([testProperty, annex])
    await store.loadEntry('tenant-001', 'sep')
    await store.loadPayments('tenant-001', 'sep')
    const pending = store.reversePayment('tenant-001', store.payments.sep!.payments[0]!, REASON)

    useAccessStore().selectProperty(annex.id)
    await pending

    expect(store.payments).toEqual({})
    expect(store.getEntry('tenant-001', 'sep')).toBeNull()
  })
})

describe('correcting bills', () => {
  const voidEntryApi = vi.mocked(rentEntryService.voidEntry)
  const correctEntryApi = vi.mocked(rentEntryService.correctEntry)
  const REASON = 'Electricity units were entered as 750 instead of 75.'
  // October with 750 units: ₹15,000 + 750 × ₹6 + ₹300 = ₹19,800.
  const wrong = makeEntry({ id: 'oct', billingMonth: '2026-10', electricityUnits: 750 })
  const corrected: EntryCorrectionInput = {
    rentAmount: 15000,
    electricityUnits: 75,
    waterAmount: 300,
    notes: '',
    reason: REASON,
  }

  beforeEach(() => {
    fakeEntries.entries = [wrong, september]
  })

  async function loaded() {
    const store = await withProperty()
    await store.loadEntry('tenant-001', 'oct')
    await store.loadHistory('tenant-001', {})
    await store.loadSummary('tenant-001')
    return store
  }

  async function correctionError(promise: Promise<unknown>): Promise<EntryCorrectionError> {
    const error = await promise.then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(EntryCorrectionError)
    return error as EntryCorrectionError
  }

  describe('voidEntry', () => {
    it('shows the bill as void, drops it from the history and reloads the summary', async () => {
      const store = await loaded()
      expect(store.summaries['tenant-001']!.latest?.id).toBe('oct')

      const result = await store.voidEntry('tenant-001', wrong, `  ${REASON} `)

      expect(voidEntryApi).toHaveBeenCalledWith(testProperty.id, 'tenant-001', 'oct', REASON)
      expect(result.replayed).toBe(false)
      expect(store.getEntry('tenant-001', 'oct')).toMatchObject({
        billStatus: 'void',
        status: null,
        outstanding: 0,
        voided: { reason: REASON },
      })
      // The summary is forgotten for the dashboard to reload; the history reloads without it.
      expect(store.summaries['tenant-001']).toBeUndefined()
      await flushPromises()
      expect(store.history.entries.map((entry) => entry.id)).toEqual(['sep'])
    })

    it('keeps a void bill in a history that shows void bills', async () => {
      const store = await withProperty()
      await store.loadHistory('tenant-001', { includeVoid: true })

      await store.voidEntry('tenant-001', wrong, REASON)
      await flushPromises()

      expect(store.history.includeVoid).toBe(true)
      expect(store.history.entries.map((e) => [e.id, e.billStatus])).toEqual([
        ['oct', 'void'],
        ['sep', 'active'],
      ])
    })

    it('refuses an empty reason without asking the backend', async () => {
      const store = await loaded()

      const error = await correctionError(store.voidEntry('tenant-001', wrong, '  '))

      expect(error.message).toBe('Say why this bill is being voided.')
      expect(voidEntryApi).not.toHaveBeenCalled()
    })

    it('says to reverse the payments first, and reloads them', async () => {
      addFakePayment(makePayment({ id: 'p-1', entryId: 'oct', amount: 1000 }))
      const store = await loaded()
      getPayments.mockClear()

      const error = await correctionError(store.voidEntry('tenant-001', wrong, REASON))

      expect(error.message).toBe(UNREVERSED_PAYMENTS_MESSAGE)
      expect(error.uncertain).toBe(false)
      await flushPromises()
      expect(getPayments).toHaveBeenCalledWith(testProperty.id, 'tenant-001', 'oct')
      expect(store.getEntry('tenant-001', 'oct')!.billStatus).toBe('active')
    })

    it('refreshes the bill when it was voided for another reason', async () => {
      const store = await loaded()
      await store.voidEntry('tenant-001', wrong, 'Entered twice')

      const error = await correctionError(store.voidEntry('tenant-001', wrong, REASON))

      expect(error.message).toBe(VOID_CONFLICT_MESSAGE)
    })

    it('after a lost response says to retry with the same reason and reloads the bill', async () => {
      const store = await loaded()
      const fakeVoid = voidEntryApi.getMockImplementation()!
      voidEntryApi.mockImplementationOnce(async (...args) => {
        await fakeVoid(...args)
        throw new ApiError('network', 'Network Error')
      })

      const error = await correctionError(store.voidEntry('tenant-001', wrong, REASON))

      expect(error).toMatchObject({ message: VOID_UNCONFIRMED_MESSAGE, uncertain: true })
      await flushPromises()
      expect(store.getEntry('tenant-001', 'oct')!.billStatus).toBe('void')
    })

    it('says only owners may, for a manager', async () => {
      const store = await loaded()
      voidEntryApi.mockRejectedValueOnce(new ApiError('forbidden', 'Forbidden'))

      const error = await correctionError(store.voidEntry('tenant-001', wrong, REASON))

      expect(error.message).toBe("Only the property's owners can void or correct bills.")
    })
  })

  describe('correctEntry', () => {
    it('shows both bills linked, the replacement in the history and reloads the summary', async () => {
      const store = await loaded()

      const result = await store.correctEntry('tenant-001', wrong, corrected, KEY)

      expect(correctEntryApi).toHaveBeenCalledWith(
        testProperty.id,
        'tenant-001',
        'oct',
        corrected,
        KEY,
      )
      const replacement = result.replacement
      expect(replacement).toMatchObject({
        billStatus: 'active',
        billingMonth: '2026-10',
        totalDue: 15750,
        electricityRate: 6,
        replacesEntryId: 'oct',
      })
      expect(store.getEntry('tenant-001', 'oct')).toMatchObject({
        billStatus: 'void',
        replacedByEntryId: replacement.id,
      })
      expect(store.getEntry('tenant-001', replacement.id)).toEqual(replacement)
      expect(store.summaries['tenant-001']).toBeUndefined()
      await flushPromises()
      expect(store.history.entries.map((entry) => entry.id)).toEqual([replacement.id, 'sep'])
    })

    it('refuses an invalid or unchanged correction without asking the backend', async () => {
      const store = await loaded()

      for (const change of [
        { reason: '' },
        { electricityUnits: -1 },
        { electricityUnits: 750 },
      ] as Partial<EntryCorrectionInput>[]) {
        await correctionError(
          store.correctEntry('tenant-001', wrong, { ...corrected, ...change }, KEY),
        )
      }
      expect(correctEntryApi).not.toHaveBeenCalled()
    })

    it('says to reverse the payments first; nothing changes', async () => {
      addFakePayment(makePayment({ id: 'p-1', entryId: 'oct', amount: 1000 }))
      const store = await loaded()

      const error = await correctionError(store.correctEntry('tenant-001', wrong, corrected, KEY))

      expect(error).toMatchObject({ message: UNREVERSED_PAYMENTS_MESSAGE, uncertain: false })
      expect(fakeEntries.entries).toHaveLength(2)
      expect(store.getEntry('tenant-001', 'oct')!.billStatus).toBe('active')
    })

    it('refreshes a bill voided meanwhile', async () => {
      const store = await loaded()
      await store.voidEntry('tenant-001', wrong, 'Entered twice')

      const error = await correctionError(store.correctEntry('tenant-001', wrong, corrected, KEY))

      expect(error.message).toBe(ENTRY_ALREADY_VOID_MESSAGE)
    })

    it('after a lost response keeps the key, and the retry returns the same correction', async () => {
      const store = await loaded()
      const fakeCorrect = correctEntryApi.getMockImplementation()!
      correctEntryApi.mockImplementationOnce(async (...args) => {
        await fakeCorrect(...args)
        throw new ApiError('unavailable', 'Bad gateway')
      })

      const key = store.correctionKeyFor('oct')
      const error = await correctionError(store.correctEntry('tenant-001', wrong, corrected, key))
      expect(error).toMatchObject({ message: CORRECTION_UNCONFIRMED_MESSAGE, uncertain: true })
      expect(store.correctionKeyFor('oct')).toBe(key)

      const retry = await store.correctEntry('tenant-001', wrong, corrected, key)

      expect(retry.replayed).toBe(true)
      expect(fakeEntries.entries.filter((e) => e.billingMonth === '2026-10')).toHaveLength(2)
    })

    it('says when the key was used for other details', async () => {
      const store = await loaded()
      await store.correctEntry('tenant-001', wrong, corrected, KEY)

      const error = await correctionError(
        store.correctEntry('tenant-001', wrong, { ...corrected, waterAmount: 400 }, KEY),
      )

      expect(error.message).toBe(CORRECTION_KEY_CONFLICT_MESSAGE)
    })

    it('shows the backend’s own message for refused details', async () => {
      const store = await loaded()
      correctEntryApi.mockRejectedValueOnce(
        new ApiError('invalid-request', 'Invalid', null, {
          nonFieldErrors: 'Change at least one charge or the notes.',
        }),
      )

      const error = await correctionError(store.correctEntry('tenant-001', wrong, corrected, KEY))

      expect(error.message).toBe('Change at least one charge or the notes.')
    })

    it('gives a new key once one is forgotten', async () => {
      const store = await withProperty()
      const first = store.correctionKeyFor('oct')

      store.forgetCorrectionKey('oct')

      expect(store.correctionKeyFor('oct')).not.toBe(first)
    })
  })
})

describe('switching property and logging out', () => {
  it('forgets the previous property’s bills', async () => {
    const store = await withProperty([testProperty, annex])
    await store.loadHistory('tenant-001', {})
    await store.loadSummary('tenant-001')

    useAccessStore().selectProperty(annex.id)

    expect(store.history.status).toBe('idle')
    expect(store.history.entries).toEqual([])
    expect(store.summaries).toEqual({})
    expect(store.getEntry('tenant-001', 'oct')).toBeNull()
  })

  it('forgets everything when access is cleared (logout)', async () => {
    const store = await withProperty()
    await store.loadHistory('tenant-001', {})

    useAccessStore().clear()

    expect(store.history.entries).toEqual([])
    expect(store.getEntry('tenant-001', 'oct')).toBeNull()
  })

  it('ignores responses for the previous property', async () => {
    const store = await withProperty([testProperty, annex])
    const slow = deferred()
    getEntries.mockReturnValueOnce(slow.promise).mockReturnValueOnce(slow.promise)

    const history = store.loadHistory('tenant-001', {})
    const summary = store.loadSummary('tenant-001')
    useAccessStore().selectProperty(annex.id)
    slow.resolve({ entries: [october], count: 1, page: 1, hasNext: false, hasPrevious: false })
    await Promise.all([history, summary])

    expect(store.history.status).toBe('idle')
    expect(store.summaries).toEqual({})
    expect(store.getEntry('tenant-001', 'oct')).toBeNull()
  })
})
