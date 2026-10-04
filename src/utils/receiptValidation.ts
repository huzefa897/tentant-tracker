// Issuer rules, checked before a receipt is issued. Saved receipts are checked when the
// ledger loads (utils/rentLedgerStorage.ts).

import { RECEIPT_ISSUER_PLACEHOLDER_ADDRESS } from '@/config/receiptIssuer'
import type { ReceiptIssuer } from '@/types/receipt'

export const ISSUER_NAME_MAX_LENGTH = 100
export const ISSUER_ADDRESS_MAX_LENGTH = 300

// Any international number, landlines included: "+" then 8 to 15 digits.
const E164 = /^\+[1-9]\d{7,14}$/
// Deliberately loose: catches typos like a missing "@", not every invalid address.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface IssuerRules {
  // The placeholder address is fine while developing, but must never reach a real receipt.
  allowPlaceholderAddress?: boolean
}

// The first problem, or null when the issuer can go on a receipt.
export function validateReceiptIssuer(
  issuer: ReceiptIssuer,
  rules: IssuerRules = {},
): string | null {
  const name = issuer.name.trim()
  const address = issuer.address.trim()

  if (name === '') return 'The receipt issuer has no name.'
  if (name.length > ISSUER_NAME_MAX_LENGTH) {
    return `The receipt issuer name must be ${ISSUER_NAME_MAX_LENGTH} characters or fewer.`
  }

  if (issuer.managerName.trim().length > ISSUER_NAME_MAX_LENGTH) {
    return `The property manager name must be ${ISSUER_NAME_MAX_LENGTH} characters or fewer.`
  }

  if (address === '') return 'The receipt issuer has no address.'
  if (address.length > ISSUER_ADDRESS_MAX_LENGTH) {
    return `The receipt issuer address must be ${ISSUER_ADDRESS_MAX_LENGTH} characters or fewer.`
  }
  if (address === RECEIPT_ISSUER_PLACEHOLDER_ADDRESS && !rules.allowPlaceholderAddress) {
    return 'Set the property address for receipts before issuing one.'
  }

  if (issuer.contactNumber !== '' && !E164.test(issuer.contactNumber)) {
    return 'The receipt issuer contact number must be in international format, e.g. +918341413827.'
  }

  if (issuer.email !== '' && !EMAIL.test(issuer.email)) {
    return 'The receipt issuer email address is not valid.'
  }

  return null
}
