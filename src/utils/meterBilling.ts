// What a new bill can do with the readings already recorded, from the meter the backend returned.

import type { MeterPoint, TenantMeter } from '@/types/meterReading'

// The newest active reading, which a new reading must follow. The last billed point (the
// baseline, if nothing is billed) when there are no readings.
export function latestReading(meter: TenantMeter): MeterPoint | null {
  const latest = meter.readings.find((reading) => reading.status === 'active')
  if (!latest) return meter.lastBilled
  return { id: latest.id, reading: latest.reading, readOn: latest.readOn }
}

// The recorded reading the next meter bill can close on: the newest active one, when no bill
// closes on it yet and it's after the last billed reading (on its day too, for the baseline,
// which has no day the meter was read). Null when there is none, and a new reading is needed.
export function unbilledReading(meter: TenantMeter): MeterPoint | null {
  const latest = meter.readings.find((reading) => reading.status === 'active')
  const from = meter.lastBilled
  if (!latest || latest.billedBy || !from) return null
  const after = from.id ? latest.readOn > from.readOn : latest.readOn >= from.readOn
  return after ? { id: latest.id, reading: latest.reading, readOn: latest.readOn } : null
}
