// Countries supported for phone sign-in. Validation, input formatting and display all read
// from this table, so adding a country is one entry here (plus its flag in CountryFlag).

export type PhoneCountryCode = 'IN' | 'AU' | 'US'

export interface PhoneCountry {
  code: PhoneCountryCode
  name: string
  dialCode: string
  // National number without the trunk prefix, e.g. "8341413827" for India.
  nationalNumber: RegExp
  maxDigits: number
  // Digit group sizes for display: [5, 5] -> "83414 13827".
  groups: number[]
  // Dialled before a national number at home ("0412 345 678", "1 201 555 0123").
  // Stripped from typed input so either form works.
  trunkPrefix: string
  placeholder: string
}

export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  {
    code: 'IN',
    name: 'India',
    dialCode: '+91',
    // Mobile numbers: 10 digits starting 6-9.
    nationalNumber: /^[6-9]\d{9}$/,
    maxDigits: 10,
    groups: [5, 5],
    trunkPrefix: '0',
    placeholder: '98765 43210',
  },
  {
    code: 'AU',
    name: 'Australia',
    dialCode: '+61',
    // Mobile numbers: 9 digits starting 4 (written "04xx xxx xxx" at home).
    nationalNumber: /^4\d{8}$/,
    maxDigits: 9,
    groups: [3, 3, 3],
    trunkPrefix: '0',
    placeholder: '412 345 678',
  },
  {
    code: 'US',
    name: 'United States',
    dialCode: '+1',
    // NANP: area code and exchange both start 2-9. US mobiles share the format with landlines.
    nationalNumber: /^[2-9]\d{2}[2-9]\d{6}$/,
    maxDigits: 10,
    groups: [3, 3, 4],
    trunkPrefix: '1',
    placeholder: '201 555 0123',
  },
]

export const DEFAULT_PHONE_COUNTRY: PhoneCountry = PHONE_COUNTRIES[0]!

export function getPhoneCountry(code: PhoneCountryCode): PhoneCountry {
  return PHONE_COUNTRIES.find((country) => country.code === code) ?? DEFAULT_PHONE_COUNTRY
}

// "+61412345678" -> Australia + "412345678". Null for unsupported or invalid numbers.
export function parsePhoneNumber(
  phoneNumber: string,
): { country: PhoneCountry; nationalNumber: string } | null {
  for (const country of PHONE_COUNTRIES) {
    if (!phoneNumber.startsWith(country.dialCode)) continue

    const nationalNumber = phoneNumber.slice(country.dialCode.length)
    if (country.nationalNumber.test(nationalNumber)) return { country, nationalNumber }
  }

  return null
}

// Raw input -> national digits: drops non-digits and a leading trunk prefix, caps the length.
export function toNationalDigits(country: PhoneCountry, value: string): string {
  let digits = value.replace(/\D/g, '')

  if (digits.startsWith(country.trunkPrefix)) digits = digits.slice(country.trunkPrefix.length)

  return digits.slice(0, country.maxDigits)
}

// "412345678" -> "412 345 678". Works on partial input while typing.
export function groupNationalDigits(country: PhoneCountry, digits: string): string {
  const parts: string[] = []
  let start = 0

  for (const size of country.groups) {
    if (start >= digits.length) break
    parts.push(digits.slice(start, start + size))
    start += size
  }

  if (start < digits.length) parts.push(digits.slice(start))

  return parts.join(' ')
}
