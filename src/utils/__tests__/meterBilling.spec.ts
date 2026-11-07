import { describe, expect, it } from 'vitest'

import type { MeterPoint, MeterReading, TenantMeter } from '@/types/meterReading'
import { latestReading, unbilledReading } from '@/utils/meterBilling'

function reading(overrides: Partial<MeterReading>): MeterReading {
  return {
    id: 'r',
    reading: 2563,
    readOn: '2026-10-31',
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

describe('unbilledReading', () => {
  it('is the newest reading when no bill closes on it', () => {
    const found = unbilledReading(
      meter([reading({ id: 'nov', reading: 2876, readOn: '2026-11-30' })]),
    )
    expect(found).toEqual({ id: 'nov', reading: 2876, readOn: '2026-11-30' })
  })

  it('is none when the newest reading is billed, or there are no readings', () => {
    const billed = reading({ id: 'oct', billedBy: { id: 'e', billingMonth: '2026-10' } })
    expect(
      unbilledReading(meter([billed], { id: 'oct', reading: 2563, readOn: '2026-10-31' })),
    ).toBe(null)
    expect(unbilledReading(meter([]))).toBe(null)
  })

  it('skips void readings', () => {
    const voided = reading({ id: 'void', status: 'void', readOn: '2026-12-15' })
    const nov = reading({ id: 'nov', readOn: '2026-11-30' })
    expect(unbilledReading(meter([voided, nov]))?.id).toBe('nov')
  })

  it('needs the reading to be after the last billed one', () => {
    const early = reading({ id: 'early', readOn: '2026-10-15' })
    const lastBilled = { id: 'oct', reading: 2563, readOn: '2026-10-31' }
    expect(unbilledReading(meter([early], lastBilled))).toBe(null)
  })

  it('accepts a reading on the baseline’s day, which has no day of its own', () => {
    const sameDay = reading({ id: 'day', reading: 2410, readOn: '2026-09-30' })
    expect(unbilledReading(meter([sameDay]))?.id).toBe('day')
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
