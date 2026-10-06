import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { rentEntryService } from '@/services/rentEntry.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import {
  DUPLICATE_ENTRY_MESSAGE,
  ENTRIES_LOAD_ERROR_MESSAGE,
  EntrySaveError,
  PAYMENTS_UNAVAILABLE_MESSAGE,
  SAVE_ERROR_MESSAGE,
  SAVE_UNCONFIRMED_MESSAGE,
  useRentEntryStore,
} from '@/stores/rentEntry'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { makeEntry } from '@/test/rentEntries'
import type { NewRentEntrySubmission, RentEntryInput, RentEntryPage } from '@/types/rentEntry'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))

const createEntry = vi.mocked(rentEntryService.createEntry)
const getEntries = vi.mocked(rentEntryService.getEntries)
const getEntry = vi.mocked(rentEntryService.getEntry)

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
    await store.addEntry({ entry: { ...input }, initialPayment: null })
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

  it('saves through the API and returns the backend’s bill', async () => {
    const store = await withProperty()

    const entry = await store.addEntry(submission())

    expect(createEntry).toHaveBeenCalledWith(testProperty.id, 'tenant-001', input)
    expect(entry).toMatchObject({ billingMonth: '2026-10', totalDue: 15750, status: 'unpaid' })
    expect(store.getEntry('tenant-001', entry.id)).toEqual(entry)
  })

  it('returns the backend’s figures, not the preview’s', async () => {
    fakeEntries.rate = 7
    const store = await withProperty()

    const entry = await store.addEntry(submission())

    expect(entry).toMatchObject({ electricityRate: 7, electricityAmount: 525, totalDue: 15825 })
  })

  it('drops the tenant’s summary so the dashboard reloads it', async () => {
    const store = await withProperty()
    await store.loadSummary('tenant-001')

    await store.addEntry(submission())

    expect(store.summaries['tenant-001']).toBeUndefined()
  })

  it('refuses a payment rather than dropping it', async () => {
    const store = await withProperty()

    const error = await saveError(
      store.addEntry({
        ...submission(),
        initialPayment: { amount: 1000, paidDate: '2026-10-01', notes: '' },
      }),
    )

    expect(error.message).toBe(PAYMENTS_UNAVAILABLE_MESSAGE)
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('refuses an invalid entry without calling the API', async () => {
    const store = await withProperty()

    const error = await saveError(store.addEntry(submission({ rentAmount: 0 })))

    expect(error.message).toBe('This entry is not valid. Check the form and try again.')
    expect(createEntry).not.toHaveBeenCalled()
  })

  it('reports a duplicate month with the bill already saved for it', async () => {
    const store = await withProperty()

    const error = await saveError(store.addEntry(submission({ billingMonth: '2026-09' })))

    expect(error.message).toBe(DUPLICATE_ENTRY_MESSAGE)
    expect(error.existingEntry?.id).toBe('sep')
    expect(fakeEntries.entries).toHaveLength(1)
  })

  it('shows the backend’s reason for a rejected field', async () => {
    const store = await withProperty()
    createEntry.mockRejectedValueOnce(
      new ApiError('invalid-request', 'Bad request', null, {
        billingMonth: "This month is outside the tenancy's occupancy period.",
      }),
    )

    const error = await saveError(store.addEntry(submission()))

    expect(error.message).toBe("This month is outside the tenancy's occupancy period.")
  })

  it('checks whether a save that timed out went through', async () => {
    const store = await withProperty()
    // Saved on the server, but the response never arrived.
    createEntry.mockImplementationOnce(async () => {
      fakeEntries.entries = [
        ...fakeEntries.entries,
        makeEntry({ id: 'saved', billingMonth: '2026-10' }),
      ]
      throw new ApiError('network')
    })

    const error = await saveError(store.addEntry(submission()))

    expect(getEntries).toHaveBeenCalledWith(testProperty.id, 'tenant-001', {
      billingMonth: '2026-10',
    })
    expect(error.message).toBe(
      'October 2026 now has a saved entry. Open it to check it before adding another.',
    )
    expect(error.existingEntry?.id).toBe('saved')
  })

  it('invites a retry when a save that timed out did not go through', async () => {
    const store = await withProperty()
    createEntry.mockRejectedValueOnce(new ApiError('network'))

    const error = await saveError(store.addEntry(submission()))

    expect(error.message).toBe(SAVE_ERROR_MESSAGE)
    expect(error.existingEntry).toBeNull()
  })

  it('says so when it can’t tell whether the save went through', async () => {
    const store = await withProperty()
    createEntry.mockRejectedValueOnce(new ApiError('unavailable'))
    getEntries.mockRejectedValueOnce(new ApiError('network'))

    const error = await saveError(store.addEntry(submission()))

    expect(error.message).toBe(SAVE_UNCONFIRMED_MESSAGE)
  })

  it('explains a refusal to save', async () => {
    const store = await withProperty()
    createEntry.mockRejectedValueOnce(new ApiError('forbidden'))

    const error = await saveError(store.addEntry(submission()))

    expect(error.message).toBe("You don't have permission to add entries for this property.")
  })

  it('needs a selected property', async () => {
    const store = useRentEntryStore()

    await expect(store.addEntry(submission())).rejects.toThrow('Choose a property first.')
    expect(createEntry).not.toHaveBeenCalled()
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
