import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService } from '@/services/access.service'
import { flushPromises } from '@vue/test-utils'

import { ApiError } from '@/services/apiError'
import { paymentService } from '@/services/payment.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import {
  DUPLICATE_ENTRY_MESSAGE,
  ENTRIES_LOAD_ERROR_MESSAGE,
  ENTRY_KEY_CONFLICT_MESSAGE,
  EntrySaveError,
  PAYMENT_KEY_CONFLICT_MESSAGE,
  PAYMENT_UNCONFIRMED_MESSAGE,
  PaymentSaveError,
  SAVE_UNCONFIRMED_MESSAGE,
  useRentEntryStore,
} from '@/stores/rentEntry'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { makeEntry, makePayment } from '@/test/rentEntries'
import type { PaymentInput } from '@/types/payment'
import type { NewRentEntrySubmission, RentEntryInput, RentEntryPage } from '@/types/rentEntry'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))

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
