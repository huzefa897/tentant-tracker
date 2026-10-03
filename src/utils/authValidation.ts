// Auth input rules, shared by the forms (UX) and the auth service (contract).

export const OTP_LENGTH = 6

// Indian mobile numbers: 10 digits starting 6-9.
const INDIAN_MOBILE_DIGITS = /^[6-9]\d{9}$/
const INDIAN_MOBILE_E164 = /^\+91[6-9]\d{9}$/
const OTP_CODE = new RegExp(`^\\d{${OTP_LENGTH}}$`)

// "8341413827" (as typed, without +91)
export function isValidIndianMobileDigits(digits: string): boolean {
  return INDIAN_MOBILE_DIGITS.test(digits)
}

// "+918341413827"
export function isValidIndianPhoneNumber(phoneNumber: string): boolean {
  return INDIAN_MOBILE_E164.test(phoneNumber)
}

export function isValidOtpCode(code: string): boolean {
  return OTP_CODE.test(code)
}
