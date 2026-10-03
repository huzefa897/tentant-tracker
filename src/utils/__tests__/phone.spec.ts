import { describe, expect, it } from 'vitest'

import { formatIndianPhoneNumberNational, formatPhoneNumber } from '@/utils/phone'

describe('formatPhoneNumber', () => {
  it.each([
    ['+918341413827', '+91 83414 13827'],
    ['+61412345678', '+61 412 345 678'],
    ['+12015550123', '+1 201 555 0123'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatPhoneNumber(value)).toBe(expected)
  })

  it.each(['8341413827', '+9183414138', '+4407911123456', '+61212345678', ''])(
    'returns %j unchanged when it is not a supported E.164 number',
    (value) => {
      expect(formatPhoneNumber(value)).toBe(value)
    },
  )
})

describe('formatIndianPhoneNumberNational', () => {
  it('formats an E.164 Indian number without the country code', () => {
    expect(formatIndianPhoneNumberNational('+918341413827')).toBe('83414 13827')
  })

  it('returns non-E.164 input unchanged', () => {
    expect(formatIndianPhoneNumberNational('8341413827')).toBe('8341413827')
  })
})
