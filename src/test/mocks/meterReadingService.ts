import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import type { MeterWrite } from '@/services/meterReading.service'
import type {
  MeterPoint,
  MeterReading,
  MeterReadingCorrectionInput,
  MeterReadingInput,
  TenantMeter,
} from '@/types/meterReading'

// A fake meterReadingService that keeps each tenant's readings like the API: newest first,
// one active reading a day, never below the one before, consumption derived, idempotency keys
// remembered (a retry returns what the key recorded). A reading a bill closes on (billedBy) is
// reading_in_use. Use it with
//   vi.mock('@/services/meterReading.service', () => import('@/test/mocks/meterReadingService'))
// and call resetMeterReadingService() in beforeEach. Set a tenant's meter with setFakeMeter().

export const fakeMeters: {
  meters: Record<string, { baseline: MeterPoint; lastBilled: MeterPoint; readings: MeterReading[] }>
  seq: number
} = { meters: {}, seq: 0 }

const keys = new Map<string, string>() // idempotency key → reading id

export const meterReadingService = {
  getMeter: vi.fn(),
  recordReading: vi.fn(),
  voidReading: vi.fn(),
  correctReading: vi.fn(),
}

export function makeReading(overrides: Partial<MeterReading> = {}): MeterReading {
  fakeMeters.seq++
  return {
    id: `reading-${String(fakeMeters.seq).padStart(3, '0')}`,
    reading: 2563,
    readOn: '2026-10-31',
    enteredUnits: null,
    notes: '',
    status: 'active',
    consumption: null,
    billedBy: null,
    createdAt: '2026-10-31T10:00:00Z',
    voided: null,
    replacesReadingId: null,
    replacedByReadingId: null,
    ...overrides,
  }
}

// Gives a tenant a meter: its baseline, and readings in any order (the fake sorts them).
export function setFakeMeter(
  tenantId: string,
  baseline: MeterPoint = { reading: 2400, readOn: '2026-09-01' },
  readings: MeterReading[] = [],
  lastBilled: MeterPoint = { id: null, ...baseline },
) {
  fakeMeters.meters[tenantId] = { baseline, lastBilled, readings }
}

function meterOf(tenantId: string) {
  const meter = fakeMeters.meters[tenantId]
  if (!meter)
    throw new ApiError('invalid-request', 'Invalid', null, {
      reading: 'The meter isn’t set up yet: set its baseline in admin.',
    })
  return meter
}

// The meter as the API returns it: newest first, consumption from the active reading before.
function snapshot(tenantId: string): TenantMeter {
  const meter = fakeMeters.meters[tenantId]
  if (!meter) return { baseline: null, lastBilled: null, readings: [] }
  const ordered = [...meter.readings].sort(
    (a, b) => a.readOn.localeCompare(b.readOn) || a.createdAt.localeCompare(b.createdAt),
  )
  let previous = meter.baseline.reading
  const withConsumption = ordered.map((reading) => {
    if (reading.status === 'void') return { ...reading, consumption: null }
    const consumption = (Math.round(reading.reading * 1000) - Math.round(previous * 1000)) / 1000
    previous = reading.reading
    return { ...reading, consumption }
  })
  return {
    baseline: { ...meter.baseline },
    lastBilled: { ...meter.lastBilled },
    readings: withConsumption.reverse(),
  }
}

// Units are added to the newest active reading (else the baseline), dated after it, like the API.
function readingFor(tenantId: string, input: MeterReadingInput): number {
  if (input.units === undefined) return input.reading
  const meter = meterOf(tenantId)
  const newest = meter.readings
    .filter((r) => r.status === 'active')
    .sort((a, b) => b.readOn.localeCompare(a.readOn))[0]
  if (newest && input.readOn <= newest.readOn) {
    throw new ApiError('invalid-request', 'Invalid', null, {
      readOn: 'Units are added to the latest reading: date them after it.',
    })
  }
  const from = newest?.reading ?? meter.baseline.reading
  return (Math.round(from * 1000) + Math.round(input.units * 1000)) / 1000
}

function checkFits(
  tenantId: string,
  input: { reading: number; readOn: string },
  ignoring?: string,
) {
  const meter = meterOf(tenantId)
  const active = meter.readings.filter((r) => r.status === 'active' && r.id !== ignoring)
  if (active.some((r) => r.readOn === input.readOn)) {
    throw new ApiError('conflict', 'Conflict', 'duplicate_reading_day')
  }
  const before = active.filter((r) => r.readOn < input.readOn).map((r) => r.reading)
  const floor = Math.max(meter.baseline.reading, ...before)
  if (input.reading < floor) {
    throw new ApiError('invalid-request', 'Invalid', null, {
      reading: `The reading can't be below ${floor}.`,
    })
  }
}

function inUse(reading: MeterReading) {
  if (reading.billedBy) {
    throw new ApiError(
      'conflict',
      'Conflict',
      'reading_in_use',
      {},
      { entries: [reading.billedBy] },
    )
  }
}

function findReading(tenantId: string, readingId: string) {
  const reading = meterOf(tenantId).readings.find((r) => r.id === readingId)
  if (!reading) throw new ApiError('not-found', 'Not found')
  return reading
}

function write(tenantId: string, readingId: string, replayed = false): MeterWrite {
  return { readingId, meter: snapshot(tenantId), replayed }
}

export function resetMeterReadingService() {
  fakeMeters.meters = {}
  fakeMeters.seq = 0
  keys.clear()
  meterReadingService.getMeter
    .mockReset()
    .mockImplementation(async (_propertyId: string, tenantId: string) => snapshot(tenantId))
  meterReadingService.recordReading
    .mockReset()
    .mockImplementation(
      async (_propertyId: string, tenantId: string, input: MeterReadingInput, key: string) => {
        const known = keys.get(key)
        if (known) return write(tenantId, known, true)
        const value = readingFor(tenantId, input)
        checkFits(tenantId, { reading: value, readOn: input.readOn })
        const reading = makeReading({
          reading: value,
          readOn: input.readOn,
          notes: input.notes,
          enteredUnits: input.units ?? null,
          createdAt: new Date().toISOString(),
        })
        fakeMeters.meters[tenantId]!.readings.push(reading)
        keys.set(key, reading.id)
        return write(tenantId, reading.id)
      },
    )
  meterReadingService.voidReading
    .mockReset()
    .mockImplementation(
      async (_propertyId: string, tenantId: string, readingId: string, reason: string) => {
        const reading = findReading(tenantId, readingId)
        if (reading.status === 'void') {
          if (reading.voided?.reason === reason) return write(tenantId, readingId, true)
          throw new ApiError('conflict', 'Conflict', 'reading_void_conflict')
        }
        inUse(reading)
        reading.status = 'void'
        reading.voided = { at: new Date().toISOString(), byName: 'Test Owner', reason }
        return write(tenantId, readingId)
      },
    )
  meterReadingService.correctReading
    .mockReset()
    .mockImplementation(
      async (
        _propertyId: string,
        tenantId: string,
        readingId: string,
        input: MeterReadingCorrectionInput,
        key: string,
      ) => {
        const known = keys.get(key)
        if (known) return write(tenantId, known, true)
        const original = findReading(tenantId, readingId)
        if (original.status === 'void') throw new ApiError('conflict', 'Conflict', 'reading_void')
        inUse(original)
        checkFits(tenantId, input, readingId)
        const replacement = makeReading({
          reading: input.reading,
          readOn: input.readOn,
          notes: input.notes,
          createdAt: new Date().toISOString(),
          replacesReadingId: readingId,
        })
        original.status = 'void'
        original.voided = {
          at: new Date().toISOString(),
          byName: 'Test Owner',
          reason: input.reason,
        }
        original.replacedByReadingId = replacement.id
        fakeMeters.meters[tenantId]!.readings.push(replacement)
        keys.set(key, replacement.id)
        return write(tenantId, replacement.id)
      },
    )
}

resetMeterReadingService()
