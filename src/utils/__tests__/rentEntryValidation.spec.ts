import { describe, expect, it } from 'vitest'

import {
  getDraftTotalDue,
  NOTES_MAX_LENGTH,
  parseRentEntryDraft,
  type RentEntryDraft,
  toAmount,
  validateRentEntryDraft,
} from '@/utils/rentEntryValidation'

const today = '2026-10-03'

function draft(overrides: Partial<RentEntryDraft> = {}): RentEntryDraft {
  return {
    billingMonth: '2026-09',
    rentAmount: 15000,
    electricityUnits: 75,
    electricityRate: 6,
    waterAmount: 300,
    totalPaid: 0,
    paidDate: '',
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
  it('accepts a valid unpaid entry', () => {
    expect(validateRentEntryDraft(draft(), today)).toEqual({})
  })

  it('accepts a valid partly paid entry', () => {
    expect(validateRentEntryDraft(draft({ totalPaid: 10000, paidDate: today }), today)).toEqual({})
  })

  it.each(['', '2026-13', 'September'])('requires a valid billing month (%j)', (billingMonth) => {
    expect(validateRentEntryDraft(draft({ billingMonth }), today).billingMonth).toBe(
      'Select the billing month.',
    )
  })

  it.each(['' as const, 0, -100, NaN])('requires rent greater than zero (%j)', (rentAmount) => {
    expect(validateRentEntryDraft(draft({ rentAmount }), today).rentAmount).toBe(
      'Enter a rent amount greater than zero.',
    )
  })

  it('requires electricity units but allows 0', () => {
    expect(validateRentEntryDraft(draft({ electricityUnits: '' }), today).electricityUnits).toBe(
      'Enter electricity units, or use 0 if there was no consumption.',
    )
    expect(validateRentEntryDraft(draft({ electricityUnits: 0 }), today)).toEqual({})
  })

  it('rejects negative electricity units', () => {
    expect(validateRentEntryDraft(draft({ electricityUnits: -1 }), today).electricityUnits).toBe(
      'Electricity units cannot be negative.',
    )
  })

  it('rejects an invalid electricity rate', () => {
    expect(validateRentEntryDraft(draft({ electricityRate: -1 }), today).electricityRate).toBe(
      "This tenant's electricity rate is invalid.",
    )
  })

  it('requires a non-negative water amount', () => {
    expect(validateRentEntryDraft(draft({ waterAmount: '' }), today).waterAmount).toBe(
      'Enter the water amount, or use 0 if there is none.',
    )
    expect(validateRentEntryDraft(draft({ waterAmount: -1 }), today).waterAmount).toBe(
      'Water amount cannot be negative.',
    )
  })

  it('requires total paid', () => {
    expect(validateRentEntryDraft(draft({ totalPaid: '' }), today).totalPaid).toBe(
      'Enter the amount paid, or use 0 if nothing was paid.',
    )
  })

  it('rejects a negative payment', () => {
    expect(validateRentEntryDraft(draft({ totalPaid: -1 }), today).totalPaid).toBe(
      'Total paid cannot be negative.',
    )
  })

  it('blocks a payment greater than the total due', () => {
    expect(
      validateRentEntryDraft(draft({ totalPaid: 16000, paidDate: today }), today).totalPaid,
    ).toBe('Total paid cannot exceed the total due.')
  })

  it('allows paying exactly the total due', () => {
    expect(validateRentEntryDraft(draft({ totalPaid: 15750, paidDate: today }), today)).toEqual({})
  })

  it('requires a paid date when something was paid', () => {
    expect(validateRentEntryDraft(draft({ totalPaid: 100 }), today).paidDate).toBe(
      'Select the date this payment was received.',
    )
    expect(
      validateRentEntryDraft(draft({ totalPaid: 100, paidDate: '2026-02-30' }), today).paidDate,
    ).toBe('Select the date this payment was received.')
  })

  it('ignores the paid date when nothing was paid', () => {
    expect(validateRentEntryDraft(draft({ paidDate: '2099-01-01' }), today)).toEqual({})
  })

  it('rejects a paid date in the future', () => {
    expect(
      validateRentEntryDraft(draft({ totalPaid: 100, paidDate: '2026-10-04' }), today).paidDate,
    ).toBe('Paid date cannot be in the future.')
  })

  it('allows paying in a later month than the billing month', () => {
    expect(
      validateRentEntryDraft(
        draft({ billingMonth: '2026-09', totalPaid: 100, paidDate: today }),
        today,
      ),
    ).toEqual({})
  })

  it('limits notes to the maximum length', () => {
    expect(validateRentEntryDraft(draft({ notes: 'a'.repeat(NOTES_MAX_LENGTH) }), today)).toEqual(
      {},
    )
    expect(
      validateRentEntryDraft(draft({ notes: 'a'.repeat(NOTES_MAX_LENGTH + 1) }), today).notes,
    ).toBe('Notes must be 500 characters or fewer.')
  })
})

describe('parseRentEntryDraft', () => {
  it('builds the entry input for a valid draft', () => {
    const result = parseRentEntryDraft(
      'tenant-001',
      draft({ totalPaid: 10000, paidDate: '2026-10-01', notes: '  Paid via UPI  ' }),
      today,
    )

    expect(result).toEqual({
      ok: true,
      input: {
        tenantId: 'tenant-001',
        billingMonth: '2026-09',
        rentAmount: 15000,
        electricityUnits: 75,
        electricityRate: 6,
        waterAmount: 300,
        totalPaid: 10000,
        paidDate: '2026-10-01',
        notes: 'Paid via UPI',
      },
    })
  })

  it('saves a null paid date when nothing was paid', () => {
    const result = parseRentEntryDraft('tenant-001', draft({ paidDate: '2026-10-01' }), today)

    expect(result.ok && result.input.paidDate).toBeNull()
  })

  it('returns the errors for an invalid draft', () => {
    const result = parseRentEntryDraft('tenant-001', draft({ electricityUnits: '' }), today)

    expect(result).toEqual({
      ok: false,
      errors: {
        electricityUnits: 'Enter electricity units, or use 0 if there was no consumption.',
      },
    })
  })
})
