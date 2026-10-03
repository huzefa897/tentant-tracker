import { describe, expect, it } from 'vitest'

import { formatIndianPhoneNumber, formatIndianPhoneNumberNational } from '@/utils/phone'

describe('formatIndianPhoneNumber', () => {
  it('formats an E.164 Indian number with the country code', () => {
    expect(formatIndianPhoneNumber('+918341413827')).toBe('+91 83414 13827')
  })

  it.each(['8341413827', '+9183414138', '+4407911123456', ''])(
    'returns %j unchanged when it is not Indian E.164',
    (value) => {
      expect(formatIndianPhoneNumber(value)).toBe(value)
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
