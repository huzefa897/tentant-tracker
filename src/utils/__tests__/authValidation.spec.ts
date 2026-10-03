import { describe, expect, it } from 'vitest'

import {
  isValidMobileDigits,
  isValidOtpCode,
  isValidPhoneNumber,
  OTP_LENGTH,
} from '@/utils/authValidation'
import { getPhoneCountry } from '@/utils/phoneCountries'

describe('isValidMobileDigits', () => {
  describe('India', () => {
    const india = getPhoneCountry('IN')

    it.each(['9876543210', '6000000000', '8341413827'])('accepts %s', (value) => {
      expect(isValidMobileDigits(india, value)).toBe(true)
    })

    it.each([
      ['too short', '987654321'],
      ['too long', '98765432101'],
      ['starts with 5', '5876543210'],
      ['contains a space', '98765 43210'],
      ['has a country code', '+919876543210'],
      ['empty', ''],
    ])('rejects input that is %s', (_, value) => {
      expect(isValidMobileDigits(india, value)).toBe(false)
    })
  })

  describe('Australia', () => {
    const australia = getPhoneCountry('AU')

    it('accepts a 9-digit mobile starting 4', () => {
      expect(isValidMobileDigits(australia, '412345678')).toBe(true)
    })

    it.each([
      ['a landline', '212345678'],
      ['written with the trunk 0', '0412345678'],
      ['too short', '41234567'],
    ])('rejects %s', (_, value) => {
      expect(isValidMobileDigits(australia, value)).toBe(false)
    })
  })

  describe('United States', () => {
    const us = getPhoneCountry('US')

    it('accepts a 10-digit NANP number', () => {
      expect(isValidMobileDigits(us, '2015550123')).toBe(true)
    })

    it.each([
      ['an area code starting 1', '1015550123'],
      ['an exchange starting 0', '2010550123'],
      ['too short', '201555012'],
    ])('rejects %s', (_, value) => {
      expect(isValidMobileDigits(us, value)).toBe(false)
    })
  })
})

describe('isValidPhoneNumber', () => {
  it.each(['+918341413827', '+61412345678', '+12015550123'])('accepts %s', (value) => {
    expect(isValidPhoneNumber(value)).toBe(true)
  })

  it.each([
    '8341413827',
    '+915341413827',
    '+91834141382',
    '+448341413827',
    '+91 83414 13827',
    '+610412345678',
    '+11015550123',
    '',
  ])('rejects %s', (value) => {
    expect(isValidPhoneNumber(value)).toBe(false)
  })
})

describe('isValidOtpCode', () => {
  it('uses a 6-digit code', () => {
    expect(OTP_LENGTH).toBe(6)
  })

  it('accepts exactly six digits', () => {
    expect(isValidOtpCode('924636')).toBe(true)
  })

  it.each(['92463', '9246361', '92463a', '', ' 924636'])('rejects %j', (value) => {
    expect(isValidOtpCode(value)).toBe(false)
  })
})
