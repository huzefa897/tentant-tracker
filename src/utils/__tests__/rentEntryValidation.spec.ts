import { describe, expect, it } from 'vitest'

import type { RentEntryInput } from '@/types/rentEntry'
import {
  getDraftTotalDue,
  NOTES_MAX_LENGTH,
  parseRentEntryDraft,
  type RentEntryDraft,
  toAmount,
  validateRentEntryDraft,
  validateRentEntryInput,
} from '@/utils/rentEntryValidation'

function draft(overrides: Partial<RentEntryDraft> = {}): RentEntryDraft {
  return {
    billingMonth: '2026-09',
    rentAmount: 15000,
    electricityUnits: 75,
    electricityRate: 6,
    waterAmount: 300,
    notes: '',
    ...overrides,
  }
}

describe('toAmount', () => {
  it.each([0, 1, 15000, 450.5])('accepts %s', (value) => {
    expect(toAmount(value)).toBe(value)
  })

  it.each(['', '12', NaN, Infinity, null, undefined])('rejects %j', (value) => {
    expect(toAmount(value)).toBeNull()
  })
})

describe('getDraftTotalDue', () => {
  it('adds rent, electricity and water', () => {
    expect(getDraftTotalDue(draft())).toBe(15750)
  })

  it.each([
    ['rent is empty', { rentAmount: '' }],
    ['rent is zero', { rentAmount: 0 }],
    ['units are empty', { electricityUnits: '' }],
    ['units are negative', { electricityUnits: -1 }],
    ['water is empty', { waterAmount: '' }],
    ['water is negative', { waterAmount: -5 }],
    ['the rate is invalid', { electricityRate: NaN }],
  ] as const)('is null when %s', (_, overrides) => {
    expect(getDraftTotalDue(draft(overrides))).toBeNull()
  })

  it('treats 0 units as no consumption', () => {
    expect(getDraftTotalDue(draft({ electricityUnits: 0 }))).toBe(15300)
  })
})

describe('validateRentEntryDraft', () => {
  it('accepts a valid entry', () => {
    expect(validateRentEntryDraft(draft())).toEqual({})
  })

  it.each(['', '2026-13', 'September'])('requires a valid billing month (%j)', (billingMonth) => {
    expect(validateRentEntryDraft(draft({ billingMonth })).billingMonth).toBe(
      'Select the billing month.',
    )
  })

  it.each(['' as const, 0, -100, NaN])('requires rent greater than zero (%j)', (rentAmount) => {
    expect(validateRentEntryDraft(draft({ rentAmount })).rentAmount).toBe(
      'Enter a rent amount greater than zero.',
    )
  })

  it('requires electricity units but allows 0', () => {
    expect(validateRentEntryDraft(draft({ electricityUnits: '' })).electricityUnits).toBe(
      'Enter electricity units, or use 0 if there was no consumption.',
    )
    expect(validateRentEntryDraft(draft({ electricityUnits: 0 }))).toEqual({})
  })

  it('rejects negative electricity units', () => {
    expect(validateRentEntryDraft(draft({ electricityUnits: -1 })).electricityUnits).toBe(
      'Electricity units cannot be negative.',
    )
  })

  it('rejects an invalid electricity rate', () => {
    expect(validateRentEntryDraft(draft({ electricityRate: -1 })).electricityRate).toBe(
      "This tenant's electricity rate is invalid.",
    )
  })

  it('requires a non-negative water amount', () => {
    expect(validateRentEntryDraft(draft({ waterAmount: '' })).waterAmount).toBe(
      'Enter the water amount, or use 0 if there is none.',
    )
    expect(validateRentEntryDraft(draft({ waterAmount: -1 })).waterAmount).toBe(
      'Water amount cannot be negative.',
    )
  })

  it('limits decimals to what the backend stores', () => {
    expect(validateRentEntryDraft(draft({ rentAmount: 15000.5, electricityUnits: 1.125 }))).toEqual(
      {},
    )
    expect(validateRentEntryDraft(draft({ rentAmount: 100.001 })).rentAmount).toBe(
      'Rent amount can have at most 2 decimals.',
    )
    expect(validateRentEntryDraft(draft({ electricityUnits: 1.0001 })).electricityUnits).toBe(
      'Electricity units can have at most 3 decimals.',
    )
    expect(validateRentEntryDraft(draft({ waterAmount: 1.234 })).waterAmount).toBe(
      'Water amount can have at most 2 decimals.',
    )
  })

  it('limits amounts to what the backend stores', () => {
    expect(validateRentEntryDraft(draft({ rentAmount: 99_999_999.99 }))).toEqual({})
    expect(validateRentEntryDraft(draft({ rentAmount: 100_000_000 })).rentAmount).toBe(
      'Rent amount must be at most 9,99,99,999.99.',
    )
    expect(validateRentEntryDraft(draft({ electricityUnits: 10_000_000 })).electricityUnits).toBe(
      'Electricity units must be at most 99,99,999.999.',
    )
  })

  it('limits notes to the maximum length', () => {
    expect(validateRentEntryDraft(draft({ notes: 'a'.repeat(NOTES_MAX_LENGTH) }))).toEqual({})
    expect(validateRentEntryDraft(draft({ notes: 'a'.repeat(NOTES_MAX_LENGTH + 1) })).notes).toBe(
      'Notes must be 500 characters or fewer.',
    )
  })
})

describe('validateRentEntryInput', () => {
  const input: RentEntryInput = {
    tenantId: 'tenant-001',
    billingMonth: '2026-09',
    rentAmount: 15000,
    electricityUnits: 75,
    electricityRate: 6,
    waterAmount: 300,
    notes: '',
  }

  it('accepts a valid entry', () => {
    expect(validateRentEntryInput(input)).toEqual({})
  })

  it('applies the same rules as the form', () => {
    expect(validateRentEntryInput({ ...input, rentAmount: 0 }).rentAmount).toBeDefined()
    expect(validateRentEntryInput({ ...input, billingMonth: '2026-13' }).billingMonth).toBeDefined()
  })

  it('requires a tenant', () => {
    expect(validateRentEntryInput({ ...input, tenantId: ' ' }).tenantId).toBe(
      'The entry has no tenant.',
    )
  })
})

describe('parseRentEntryDraft', () => {
  it('builds the entry input for a valid draft', () => {
    const result = parseRentEntryDraft('tenant-001', draft({ notes: '  Meter read on the 1st  ' }))

    expect(result).toEqual({
      ok: true,
      input: {
        tenantId: 'tenant-001',
        billingMonth: '2026-09',
        rentAmount: 15000,
        electricityUnits: 75,
        electricityRate: 6,
        waterAmount: 300,
        notes: 'Meter read on the 1st',
      },
    })
  })

  it('returns the errors for an invalid draft', () => {
    const result = parseRentEntryDraft('tenant-001', draft({ electricityUnits: '' }))

    expect(result).toEqual({
      ok: false,
      errors: {
        electricityUnits: 'Enter electricity units, or use 0 if there was no consumption.',
      },
    })
  })
})
