import { describe, expect, it } from 'vitest'

import type { MeterPoint, MeterReading, TenantMeter } from '@/types/meterReading'
import { latestReading, unbilledReadings } from '@/utils/meterBilling'

function reading(overrides: Partial<MeterReading>): MeterReading {
  return {
    id: 'r',
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

const baseline: MeterPoint = { id: null, reading: 2400, readOn: '2026-09-30' }

function meter(readings: MeterReading[], lastBilled = baseline): TenantMeter {
  return { baseline, lastBilled, readings }
}

describe('unbilledReadings', () => {
  it('lists the active readings no bill closes on, newest first', () => {
    const oct = reading({ id: 'oct', reading: 2563, readOn: '2026-10-31' })
    const nov = reading({ id: 'nov', reading: 2876, readOn: '2026-11-30' })
    expect(unbilledReadings(meter([nov, oct]))).toEqual([
      { id: 'nov', reading: 2876, readOn: '2026-11-30' },
      { id: 'oct', reading: 2563, readOn: '2026-10-31' },
    ])
  })

  it('keeps an older reading once a later one is recorded (a voided October bill)', () => {
    const oct = reading({ id: 'oct', readOn: '2026-10-31' })
    const nov = reading({ id: 'nov', reading: 2876, readOn: '2026-11-30' })
    expect(unbilledReadings(meter([nov, oct])).map((point) => point.id)).toEqual(['nov', 'oct'])
  })

  it('leaves out billed readings, void ones and those on or before the last billed day', () => {
    const lastBilled = { id: 'oct', reading: 2563, readOn: '2026-10-31' }
    const billed = reading({ id: 'oct', billedBy: { id: 'e', billingMonth: '2026-10' } })
    const early = reading({ id: 'early', readOn: '2026-10-15' })
    const voided = reading({ id: 'void', status: 'void', readOn: '2026-12-15' })
    const nov = reading({ id: 'nov', reading: 2876, readOn: '2026-11-30' })
    expect(unbilledReadings(meter([nov, voided, billed, early], lastBilled))).toEqual([
      { id: 'nov', reading: 2876, readOn: '2026-11-30' },
    ])
    expect(unbilledReadings(meter([]))).toEqual([])
  })

  it('accepts a reading on the baseline’s day, which has no day of its own', () => {
    const sameDay = reading({ id: 'day', reading: 2410, readOn: '2026-09-30' })
    expect(unbilledReadings(meter([sameDay])).map((point) => point.id)).toEqual(['day'])
  })
})

describe('latestReading', () => {
  it('is the newest active reading, else the last billed point', () => {
    const nov = reading({ id: 'nov', reading: 2876, readOn: '2026-11-30' })
    const voided = reading({ id: 'void', status: 'void', readOn: '2026-12-15' })
    expect(latestReading(meter([voided, nov]))).toEqual({
      id: 'nov',
      reading: 2876,
      readOn: '2026-11-30',
    })
    expect(latestReading(meter([voided]))).toEqual(baseline)
  })
})
