// What a new bill can do with the readings already recorded, from the meter the backend returned.

import type { MeterPoint, TenantMeter } from '@/types/meterReading'

// The newest active reading, which a new reading must follow. The last billed point (the
// baseline, if nothing is billed) when there are no readings.
export function latestReading(meter: TenantMeter): MeterPoint | null {
  const latest = meter.readings.find((reading) => reading.status === 'active')
  if (!latest) return meter.lastBilled
  return { id: latest.id, reading: latest.reading, readOn: latest.readOn }
}

// The recorded readings a meter bill can close on, newest first: active ones no bill closes on
// yet, after the last billed reading (on its day too, for the baseline, which has no day the
// meter was read). A bill may close on any of them; the ones before it wait for a later bill
// only if it closes on an earlier one. Empty when a new reading is needed.
export function unbilledReadings(meter: TenantMeter): MeterPoint[] {
  const from = meter.lastBilled
  if (!from) return []
  return meter.readings
    .filter((reading) => reading.status === 'active' && !reading.billedBy)
    .filter((reading) => (from.id ? reading.readOn > from.readOn : reading.readOn >= from.readOn))
    .map((reading) => ({ id: reading.id, reading: reading.reading, readOn: reading.readOn }))
}
