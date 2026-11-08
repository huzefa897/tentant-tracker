import { describe, expect, it } from 'vitest'

import {
  REASON_MAX_LENGTH,
  readingFromUnits,
  unitsBetween,
  validateMeterReadingDraft,
  validateReason,
  validateUnitsDraft,
} from '@/utils/meterReadingValidation'

const after = { id: 'reading-1', reading: 2563, readOn: '2026-10-31' }
const baseline = { id: null, reading: 2400, readOn: '2026-10-31' }
const today = '2026-11-05'

describe('validateMeterReadingDraft', () => {
  it('accepts a reading after the last one', () => {
    expect(
      validateMeterReadingDraft({ reading: 2600.5, readOn: '2026-11-04' }, { after, today }),
    ).toEqual({})
  })

  it('accepts a reading equal to the last one (nothing used)', () => {
    expect(
      validateMeterReadingDraft({ reading: 2563, readOn: '2026-11-01' }, { after, today }),
    ).toEqual({})
  })

  it.each([
    ['empty', '', 'Enter the meter reading.'],
    ['negative', -1, "A meter reading can't be negative."],
    ['too precise', 2600.1234, 'A meter reading can have at most 3 decimals.'],
    ['below the last', 2500, "The reading can't be below 2,563."],
  ])('refuses a reading that is %s', (_label, reading, message) => {
    expect(
      validateMeterReadingDraft(
        { reading: reading as number | '', readOn: '2026-11-04' },
        { after, today },
      ).reading,
    ).toBe(message)
  })

  it.each([
    ['', 'Enter the day the meter was read.'],
    ['2026-11-06', "The reading can't be dated in the future."],
    ['2026-10-31', 'The reading must be after 31 Oct 2026.'],
  ])('refuses the date %s', (readOn, message) => {
    expect(validateMeterReadingDraft({ reading: 2600, readOn }, { after, today }).readOn).toBe(
      message,
    )
  })

  it('allows the day tracking started, but not before it', () => {
    for (const start of [baseline, { reading: 2400, readOn: '2026-10-31' }]) {
      expect(
        validateMeterReadingDraft({ reading: 2410, readOn: '2026-10-31' }, { after: start, today }),
      ).toEqual({})
      expect(
        validateMeterReadingDraft({ reading: 2410, readOn: '2026-10-30' }, { after: start, today })
          .readOn,
      ).toBe("The reading can't be dated before meter tracking started on 31 Oct 2026.")
    }
  })

  it('only checks the basics without a reading to follow', () => {
    expect(
      validateMeterReadingDraft({ reading: 0, readOn: '2026-01-01' }, { after: null, today }),
    ).toEqual({})
  })
})

describe('unitsBetween', () => {
  it('subtracts exactly', () => {
    expect(unitsBetween({ reading: 2563.25, readOn: '2026-10-31' }, 2876.5)).toBe(313.25)
    expect(unitsBetween(after, 2985)).toBe(422)
  })

  it('is null until both readings are valid and in order', () => {
    expect(unitsBetween(null, 2985)).toBeNull()
    expect(unitsBetween(after, '')).toBeNull()
    expect(unitsBetween(after, 2500)).toBeNull()
  })
})

describe('validateUnitsDraft', () => {
  it('accepts units dated after the latest reading, and zero', () => {
    expect(validateUnitsDraft({ units: 109.5, readOn: '2026-11-04' }, { after, today })).toEqual({})
    expect(validateUnitsDraft({ units: 0, readOn: '2026-11-04' }, { after, today })).toEqual({})
  })

  it('accepts units on the baseline’s day, before any reading', () => {
    expect(
      validateUnitsDraft({ units: 10, readOn: '2026-10-31' }, { after: baseline, today }),
    ).toEqual({})
  })

  it.each([
    ['empty', '', 'Enter the units used.'],
    ['negative', -1, "Units used can't be negative."],
    ['too precise', 1.2345, 'Units can have at most 3 decimals.'],
  ] as const)('refuses %s units', (_label, units, message) => {
    expect(validateUnitsDraft({ units, readOn: '2026-11-04' }, { after, today }).units).toBe(
      message,
    )
  })

  it('refuses units that would take the reading over the limit', () => {
    expect(
      validateUnitsDraft({ units: 9_999_999, readOn: '2026-11-04' }, { after, today }).units,
    ).toContain('would be over')
  })

  it('dates them after the reading they’re added to, and not in the future', () => {
    expect(
      validateUnitsDraft({ units: 5, readOn: '2026-10-31' }, { after, today }).readOn,
    ).toContain('Units are added to the reading of')
    expect(
      validateUnitsDraft({ units: 5, readOn: '2026-11-06' }, { after, today }).readOn,
    ).toBe("The reading can't be dated in the future.")
  })
})

describe('readingFromUnits', () => {
  it('adds the units to the reading exactly', () => {
    expect(readingFromUnits({ ...after, reading: 2563.25 }, 109.1)).toBe(2672.35)
  })

  it('is null until the units are valid', () => {
    expect(readingFromUnits(after, '')).toBeNull()
    expect(readingFromUnits(after, -1)).toBeNull()
    expect(readingFromUnits(null, 5)).toBeNull()
  })
})

describe('validateReason', () => {
  it('needs a reason, within the limit', () => {
    expect(validateReason('  ', 'reading is being voided')).toBe(
      'Say why this reading is being voided.',
    )
    expect(validateReason('x'.repeat(REASON_MAX_LENGTH + 1), 'reading is being voided')).toMatch(
      /or fewer/,
    )
    expect(validateReason('Misread', 'reading is being voided')).toBeUndefined()
  })
})
