import { groupNationalDigits, parsePhoneNumber } from '@/utils/phoneCountries'

const INDIAN_E164 = /^\+91(\d{5})(\d{5})$/

// "+61412345678" -> "+61 412 345 678". Display only; store the E.164 value.
// Numbers outside the supported countries are returned unchanged.
export function formatPhoneNumber(phoneNumber: string): string {
  const parsed = parsePhoneNumber(phoneNumber)

  if (!parsed) return phoneNumber

  return `${parsed.country.dialCode} ${groupNationalDigits(parsed.country, parsed.nationalNumber)}`
}

// "+918341413827" -> "83414 13827", for compact layouts where +91 is implied.
export function formatIndianPhoneNumberNational(phoneNumber: string): string {
  const match = INDIAN_E164.exec(phoneNumber)

  if (!match) return phoneNumber

  return `${match[1]} ${match[2]}`
}
