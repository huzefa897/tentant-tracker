const INDIAN_E164 = /^\+91(\d{5})(\d{5})$/

// "+918341413827" -> "+91 83414 13827". Display only; store the E.164 value.
export function formatIndianPhoneNumber(phoneNumber: string): string {
  const match = INDIAN_E164.exec(phoneNumber)

  if (!match) return phoneNumber

  return `+91 ${match[1]} ${match[2]}`
}

// "+918341413827" -> "83414 13827", for compact layouts where +91 is implied.
export function formatIndianPhoneNumberNational(phoneNumber: string): string {
  const match = INDIAN_E164.exec(phoneNumber)

  if (!match) return phoneNumber

  return `${match[1]} ${match[2]}`
}
