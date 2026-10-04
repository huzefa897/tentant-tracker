import { describe, expect, it } from 'vitest'

import { RECEIPT_ISSUER_PLACEHOLDER_ADDRESS, receiptIssuer } from '@/config/receiptIssuer'
import type { ReceiptIssuer } from '@/types/receipt'
import { validateReceiptIssuer } from '@/utils/receiptValidation'

const issuer: ReceiptIssuer = {
  name: 'Saleem Towers',
  managerName: 'Test Manager',
  address: '1 Example Road\nHyderabad',
  contactNumber: '',
  email: '',
}

describe('validateReceiptIssuer', () => {
  it.each([
    ['no contact number', issuer],
    ['an Indian mobile', { ...issuer, contactNumber: '+918341413827' }],
    ['a landline', { ...issuer, contactNumber: '+914023456789' }],
    ['an email address', { ...issuer, email: 'owner@example.com' }],
    ['no manager name', { ...issuer, managerName: '' }],
  ])('accepts an issuer with %s', (_, value) => {
    expect(validateReceiptIssuer(value)).toBeNull()
  })

  it.each([
    ['no name', { ...issuer, name: '  ' }, 'The receipt issuer has no name.'],
    ['a long name', { ...issuer, name: 'a'.repeat(101) }, /name must be 100 characters/],
    ['no address', { ...issuer, address: '' }, 'The receipt issuer has no address.'],
    ['a long address', { ...issuer, address: 'a'.repeat(301) }, /address must be 300/],
    ['a national number', { ...issuer, contactNumber: '8341413827' }, /international format/],
    ['a short number', { ...issuer, contactNumber: '+9112' }, /international format/],
    ['a long manager name', { ...issuer, managerName: 'a'.repeat(101) }, /manager name must be/],
    ['an email without @', { ...issuer, email: 'owner.example.com' }, /email address is not valid/],
  ])('rejects an issuer with %s', (_, value, message) => {
    expect(validateReceiptIssuer(value)).toMatch(message)
  })

  it('rejects the placeholder address unless allowed (while developing)', () => {
    const placeholder = { ...issuer, address: RECEIPT_ISSUER_PLACEHOLDER_ADDRESS }

    expect(validateReceiptIssuer(placeholder)).toBe(
      'Set the property address for receipts before issuing one.',
    )
    expect(validateReceiptIssuer(placeholder, { allowPlaceholderAddress: true })).toBeNull()
  })

  it('accepts the configured issuer while developing', () => {
    expect(validateReceiptIssuer(receiptIssuer, { allowPlaceholderAddress: true })).toBeNull()
  })
})
