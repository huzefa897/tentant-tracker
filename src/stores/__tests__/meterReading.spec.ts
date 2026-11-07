import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import { meterReadingService } from '@/services/meterReading.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import {
  METER_LOAD_ERROR_MESSAGE,
  MeterReadingError,
  useMeterReadingStore,
} from '@/stores/meterReading'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import {
  makeReading,
  resetMeterReadingService,
  setFakeMeter,
} from '@/test/mocks/meterReadingService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/meterReading.service', () => import('@/test/mocks/meterReadingService'))

const TENANT = 'tenant-001'
const recordReading = vi.mocked(meterReadingService.recordReading)
const getMeter = vi.mocked(meterReadingService.getMeter)

async function signedIn() {
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
  return useMeterReadingStore()
}

beforeEach(() => {
  resetAuthService()
  resetAccessService()
  resetMeterReadingService()
  setActivePinia(createPinia())
  setFakeMeter(TENANT)
})

describe('useMeterReadingStore', () => {
  it('loads a tenant’s meter', async () => {
    const store = await signedIn()
    await store.loadMeter(TENANT)
    expect(store.meterFor(TENANT)).toMatchObject({
      status: 'ready',
      meter: { lastBilled: { reading: 2400 } },
      error: null,
    })
  })

  it('loads nothing until a property is selected', async () => {
    const store = useMeterReadingStore()
    await store.loadMeter(TENANT)
    expect(getMeter).not.toHaveBeenCalled()
    expect(store.meterFor(TENANT).status).toBe('idle')
  })

  it('shows a failed load as an error, never an empty meter', async () => {
    const store = await signedIn()
    getMeter.mockRejectedValueOnce(new ApiError('unavailable'))
    await store.loadMeter(TENANT)
    expect(store.meterFor(TENANT)).toEqual({
      status: 'error',
      meter: null,
      error: METER_LOAD_ERROR_MESSAGE,
    })
  })

  it('keeps only the newest load’s answer', async () => {
    const store = await signedIn()
    let release!: () => void
    getMeter.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ baseline: null, lastBilled: null, readings: [] })
        }),
    )
    const first = store.loadMeter(TENANT)
    await store.loadMeter(TENANT)
    release()
    await first
    expect(store.meterFor(TENANT).meter?.lastBilled?.reading).toBe(2400)
  })

  it('records a reading and shows the meter the backend returns', async () => {
    const store = await signedIn()
    await store.recordReading(TENANT, { reading: 2600, readOn: '2026-10-15', notes: '' })
    const meter = store.meterFor(TENANT).meter!
    expect(meter.readings.map((r) => [r.reading, r.consumption])).toEqual([[2600, 200]])
  })

  it('refuses an invalid reading without asking the backend', async () => {
    const store = await signedIn()
    await expect(
      store.recordReading(TENANT, { reading: -1, readOn: '2026-10-15', notes: '' }),
    ).rejects.toBeInstanceOf(MeterReadingError)
    expect(recordReading).not.toHaveBeenCalled()
  })

  it('retries with the same key after an uncertain failure, and a new one after', async () => {
    const store = await signedIn()
    recordReading.mockRejectedValueOnce(new ApiError('network'))
    const input = { reading: 2600, readOn: '2026-10-15', notes: '' }
    const error = await store.recordReading(TENANT, input).catch((e: unknown) => e)
    expect(error).toMatchObject({ uncertain: true })
    await store.recordReading(TENANT, input)
    const [first, second] = recordReading.mock.calls.map((call) => call[3])
    expect(second).toBe(first)

    await store.recordReading(TENANT, { reading: 2700, readOn: '2026-10-20', notes: '' })
    expect(recordReading.mock.calls[2]![3]).not.toBe(first)
  })

  it('sends changed input with a new key, even after an uncertain failure', async () => {
    const store = await signedIn()
    recordReading.mockRejectedValueOnce(new ApiError('network'))
    await store
      .recordReading(TENANT, { reading: 2600, readOn: '2026-10-15', notes: '' })
      .catch(() => {})
    await store.recordReading(TENANT, { reading: 2650, readOn: '2026-10-15', notes: '' })
    const [first, second] = recordReading.mock.calls.map((call) => call[3])
    expect(second).not.toBe(first)
  })

  it('reloads the readings when an earlier attempt saved a different reading', async () => {
    const store = await signedIn()
    recordReading.mockRejectedValueOnce(new ApiError('conflict', 'x', 'idempotency_conflict'))
    await expect(
      store.recordReading(TENANT, { reading: 2600, readOn: '2026-10-15', notes: '' }),
    ).rejects.toThrow('have been reloaded')
    await vi.waitFor(() => expect(getMeter).toHaveBeenCalledTimes(1))
    expect(store.meterFor(TENANT).status).toBe('ready')
  })

  it('explains a second reading on the same day', async () => {
    const store = await signedIn()
    setFakeMeter(TENANT, undefined, [makeReading({ reading: 2500, readOn: '2026-10-15' })])
    await expect(
      store.recordReading(TENANT, { reading: 2600, readOn: '2026-10-15', notes: '' }),
    ).rejects.toThrow('There’s already a reading on that day')
  })

  it('shows the backend’s field error for a reading that doesn’t fit', async () => {
    const store = await signedIn()
    await expect(
      store.recordReading(TENANT, { reading: 2300, readOn: '2026-10-15', notes: '' }),
    ).rejects.toThrow("The reading can't be below 2400.")
  })

  it('lists the bills that block voiding a reading', async () => {
    const store = await signedIn()
    const billed = makeReading({ billedBy: { id: 'entry-1', billingMonth: '2026-10' } })
    setFakeMeter(TENANT, undefined, [billed])
    const error = await store.voidReading(TENANT, billed.id, 'Misread').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MeterReadingError)
    expect((error as MeterReadingError).blockingEntries).toEqual([
      { id: 'entry-1', billingMonth: '2026-10' },
    ])
  })

  it('needs a reason to void or correct', async () => {
    const store = await signedIn()
    await expect(store.voidReading(TENANT, 'reading-1', ' ')).rejects.toThrow('Say why')
    await expect(
      store.correctReading(TENANT, 'reading-1', {
        reading: 1,
        readOn: '2026-10-01',
        notes: '',
        reason: '',
      }),
    ).rejects.toThrow('Say why')
  })

  it('voids and corrects a reading', async () => {
    const store = await signedIn()
    const wrong = makeReading({ reading: 2650, readOn: '2026-10-15' })
    const other = makeReading({ reading: 2700, readOn: '2026-10-20' })
    setFakeMeter(TENANT, undefined, [wrong, other])

    await store.correctReading(TENANT, wrong.id, {
      reading: 2605,
      readOn: '2026-10-15',
      notes: '',
      reason: 'Misread a digit',
    })
    let readings = store.meterFor(TENANT).meter!.readings
    expect(readings.find((r) => r.id === wrong.id)?.status).toBe('void')
    expect(readings.find((r) => r.replacesReadingId === wrong.id)?.reading).toBe(2605)

    await store.voidReading(TENANT, other.id, 'Duplicate')
    readings = store.meterFor(TENANT).meter!.readings
    expect(readings.find((r) => r.id === other.id)?.voided?.reason).toBe('Duplicate')
  })

  it('forgets a tenant’s meter', async () => {
    const store = await signedIn()
    await store.loadMeter(TENANT)
    store.forgetMeter(TENANT)
    expect(store.meterFor(TENANT).status).toBe('idle')
  })
})
