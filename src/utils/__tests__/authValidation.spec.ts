import { describe, expect, it } from 'vitest'

import {
  isValidIndianMobileDigits,
  isValidIndianPhoneNumber,
  isValidOtpCode,
  OTP_LENGTH,
} from '@/utils/authValidation'

describe('isValidIndianMobileDigits', () => {
  it.each(['9876543210', '6000000000', '8341413827'])('accepts %s', (value) => {
    expect(isValidIndianMobileDigits(value)).toBe(true)
  })

  it.each([
    ['too short', '987654321'],
    ['too long', '98765432101'],
    ['starts with 5', '5876543210'],
    ['contains a space', '98765 43210'],
    ['has a country code', '+919876543210'],
    ['empty', ''],
  ])('rejects input that is %s', (_, value) => {
    expect(isValidIndianMobileDigits(value)).toBe(false)
  })
})

describe('isValidIndianPhoneNumber', () => {
  it('accepts +91 followed by a valid mobile number', () => {
    expect(isValidIndianPhoneNumber('+918341413827')).toBe(true)
  })

  it.each(['8341413827', '+915341413827', '+91834141382', '+448341413827', '+91 83414 13827'])(
    'rejects %s',
    (value) => {
      expect(isValidIndianPhoneNumber(value)).toBe(false)
    },
  )
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
