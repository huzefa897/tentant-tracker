// Auth input rules, shared by the forms (UX) and the auth service (contract).

import { parsePhoneNumber, type PhoneCountry } from '@/utils/phoneCountries'

export const OTP_LENGTH = 6

const OTP_CODE = new RegExp(`^\\d{${OTP_LENGTH}}$`)

// "8341413827" for India, as typed (without the dial code or a trunk prefix)
export function isValidMobileDigits(country: PhoneCountry, digits: string): boolean {
  return country.nationalNumber.test(digits)
}

// E.164 in a supported country: "+918341413827", "+61412345678", "+12015550123"
export function isValidPhoneNumber(phoneNumber: string): boolean {
  return parsePhoneNumber(phoneNumber) !== null
}

export function isValidOtpCode(code: string): boolean {
  return OTP_CODE.test(code)
}
