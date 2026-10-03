import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PHONE_COUNTRY,
  getPhoneCountry,
  groupNationalDigits,
  parsePhoneNumber,
  PHONE_COUNTRIES,
  toNationalDigits,
} from '@/utils/phoneCountries'

describe('PHONE_COUNTRIES', () => {
  it('supports India, Australia and the United States, defaulting to India', () => {
    expect(PHONE_COUNTRIES.map((country) => country.code)).toEqual(['IN', 'AU', 'US'])
    expect(DEFAULT_PHONE_COUNTRY.code).toBe('IN')
  })

  it.each(PHONE_COUNTRIES.map((country) => [country.code, country]))(
    '%s placeholder is a valid number in its own display format',
    (_, country) => {
      const digits = toNationalDigits(country, country.placeholder)

      expect(country.nationalNumber.test(digits)).toBe(true)
      expect(groupNationalDigits(country, digits)).toBe(country.placeholder)
    },
  )
})

describe('getPhoneCountry', () => {
  it('returns the country for a code', () => {
    expect(getPhoneCountry('AU').dialCode).toBe('+61')
  })
})

describe('parsePhoneNumber', () => {
  it.each([
    ['+918341413827', 'IN', '8341413827'],
    ['+61412345678', 'AU', '412345678'],
    ['+12015550123', 'US', '2015550123'],
  ])('splits %s into %s and %s', (value, code, nationalNumber) => {
    const parsed = parsePhoneNumber(value)

    expect(parsed?.country.code).toBe(code)
    expect(parsed?.nationalNumber).toBe(nationalNumber)
  })

  it.each(['+447911123456', '+61212345678', '+915341413827', '918341413827', ''])(
    'returns null for %j',
    (value) => {
      expect(parsePhoneNumber(value)).toBeNull()
    },
  )
})

describe('toNationalDigits', () => {
  it('drops non-digits and caps at the country length', () => {
    expect(toNationalDigits(getPhoneCountry('IN'), '+91-83414abc138279999')).toBe('9183414138')
  })

  it.each([
    ['IN', '098765 43210', '9876543210'],
    ['AU', '0412 345 678', '412345678'],
    ['US', '1 (201) 555-0123', '2015550123'],
  ] as const)('strips the %s trunk prefix from %j', (code, value, expected) => {
    expect(toNationalDigits(getPhoneCountry(code), value)).toBe(expected)
  })
})

describe('groupNationalDigits', () => {
  it.each([
    ['IN', '8341413827', '83414 13827'],
    ['AU', '412345678', '412 345 678'],
    ['US', '2015550123', '201 555 0123'],
  ] as const)('groups a full %s number', (code, digits, expected) => {
    expect(groupNationalDigits(getPhoneCountry(code), digits)).toBe(expected)
  })

  it('groups partial input as it is typed', () => {
    const us = getPhoneCountry('US')

    expect(groupNationalDigits(us, '')).toBe('')
    expect(groupNationalDigits(us, '20')).toBe('20')
    expect(groupNationalDigits(us, '2015')).toBe('201 5')
  })

  it('appends digits beyond the groups rather than dropping them', () => {
    expect(groupNationalDigits(getPhoneCountry('AU'), '4123456789')).toBe('412 345 678 9')
  })
})
