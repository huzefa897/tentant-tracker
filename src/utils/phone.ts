// "+918341413827" -> "+91 83414 13827". Display only; store the E.164 value.
export function formatIndianPhoneNumber(phoneNumber: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(phoneNumber)

  if (!match) return phoneNumber

  return `+91 ${match[1]} ${match[2]}`
}
