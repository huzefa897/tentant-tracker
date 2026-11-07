// How a bill's electricity reads on screen, from its saved figures (never recalculated).

import type { ElectricityMode, MeterPoint } from '@/types/meterReading'
import { formatINR } from '@/utils/currency'

export interface ElectricityCharge {
  electricityMode: ElectricityMode
  electricityUnits: number
  electricityRate: number
  electricityAmount: number
  openingReading: MeterPoint | null
  closingReading: MeterPoint | null
}

export const NOT_CHARGED = 'Not charged'

export function formatReading(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 3 })
}

// What the label puts in brackets: "75 units × ₹6", or "2,563 → 2,985: 422 units × ₹8" for a
// meter bill; '' when not charged.
export function electricityDetails(charge: ElectricityCharge): string {
  if (charge.electricityMode === 'not_charged') return ''
  const units = `${formatReading(charge.electricityUnits)} units × ${formatINR(charge.electricityRate)}`
  if (charge.electricityMode === 'meter' && charge.openingReading && charge.closingReading) {
    return `${formatReading(charge.openingReading.reading)} → ${formatReading(charge.closingReading.reading)}: ${units}`
  }
  return units
}

// "Electricity (75 units × ₹6)", "Electricity (2,563 → 2,985: 422 units × ₹8)", or
// "Electricity" when it wasn't charged.
export function electricityLabel(charge: ElectricityCharge): string {
  const details = electricityDetails(charge)
  return details ? `Electricity (${details})` : 'Electricity'
}

// The amount, or "Not charged": never ₹0, which would read as if it were paid.
export function electricityValue(charge: ElectricityCharge): string {
  return charge.electricityMode === 'not_charged'
    ? NOT_CHARGED
    : formatINR(charge.electricityAmount)
}
