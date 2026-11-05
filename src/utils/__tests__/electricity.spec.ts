import { describe, expect, it } from 'vitest'

import { electricityLabel, electricityValue, NOT_CHARGED } from '@/utils/electricity'

const manual = {
  electricityMode: 'manual' as const,
  electricityUnits: 75,
  electricityRate: 6,
  electricityAmount: 450,
  openingReading: null,
  closingReading: null,
}

describe('electricity', () => {
  it('describes typed units as before', () => {
    expect(electricityLabel(manual)).toBe('Electricity (75 units × ₹6)')
    expect(electricityValue(manual)).toBe('₹450')
  })

  it('shows a meter bill’s readings', () => {
    const meter = {
      ...manual,
      electricityMode: 'meter' as const,
      electricityUnits: 422,
      electricityRate: 8,
      electricityAmount: 3376,
      openingReading: { id: 'r1', reading: 2563, readOn: '2026-10-31' },
      closingReading: { id: 'r2', reading: 2985, readOn: '2026-12-31' },
    }
    expect(electricityLabel(meter)).toBe('Electricity (2,563 → 2,985: 422 units × ₹8)')
    expect(electricityValue(meter)).toBe('₹3,376')
  })

  it('never shows electricity left off as ₹0', () => {
    const off = {
      ...manual,
      electricityMode: 'not_charged' as const,
      electricityUnits: 0,
      electricityAmount: 0,
    }
    expect(electricityLabel(off)).toBe('Electricity')
    expect(electricityValue(off)).toBe(NOT_CHARGED)
  })
})
