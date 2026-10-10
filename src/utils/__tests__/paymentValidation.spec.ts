import { describe, expect, it } from 'vitest'

import type { PaymentInput } from '@/types/payment'
import {
  type PaymentDraft,
  parsePaymentDraft,
  validatePaymentDraft,
  validatePaymentInput,
  validateReversalReason,
} from '@/utils/paymentValidation'

const today = '2026-10-03'

function draft(overrides: Partial<PaymentDraft> = {}): PaymentDraft {
  return { amount: 3000, paidDate: today, notes: '', ...overrides }
}

describe('validatePaymentDraft', () => {
  it('accepts a valid payment', () => {
    expect(validatePaymentDraft(draft(), { today, outstanding: 5750 })).toEqual({})
  })

  it('requires an amount', () => {
    expect(validatePaymentDraft(draft({ amount: '' })).amount).toBe('Enter the amount received.')
  })

  it.each([
    [0, 'Enter an amount greater than zero.'],
    [-1, 'Amount cannot be negative.'],
    [10.005, 'Amount can have at most two decimal places.'],
  ])('rejects %s', (amount, message) => {
    expect(validatePaymentDraft(draft({ amount })).amount).toBe(message)
  })

  it('accepts paise', () => {
    expect(validatePaymentDraft(draft({ amount: 0.29 }), { outstanding: 0.29 })).toEqual({})
  })

  it('allows exactly the outstanding amount', () => {
    expect(validatePaymentDraft(draft({ amount: 2750 }), { outstanding: 2750 })).toEqual({})
  })

  it('rejects more than the outstanding amount', () => {
    expect(validatePaymentDraft(draft({ amount: 3000 }), { outstanding: 2750 }).amount).toBe(
      'Amount cannot exceed the outstanding ₹2,750.',
    )
    expect(validatePaymentDraft(draft({ amount: 2750.01 }), { outstanding: 2750 }).amount).toBe(
      'Amount cannot exceed the outstanding ₹2,750.',
    )
  })

  it('compares in paise, so float noise is not an overpayment', () => {
    expect(validatePaymentDraft(draft({ amount: 0.3 }), { outstanding: 0.1 + 0.2 })).toEqual({})
  })

  it('says when the bill is already fully paid', () => {
    expect(validatePaymentDraft(draft({ amount: 1 }), { outstanding: 0 }).amount).toBe(
      'This bill is already fully paid.',
    )
  })

  it.each(['', '2026-02-30', 'yesterday'])('requires a valid paid date (%j)', (paidDate) => {
    expect(validatePaymentDraft(draft({ paidDate })).paidDate).toBe(
      'Select the date this payment was received.',
    )
  })

  it('rejects a paid date in the future only when given today', () => {
    const future = draft({ paidDate: '2026-10-04' })

    expect(validatePaymentDraft(future, { today }).paidDate).toBe(
      'Paid date cannot be in the future.',
    )
    expect(validatePaymentDraft(future)).toEqual({})
  })

  it('allows a paid date of today and earlier', () => {
    expect(validatePaymentDraft(draft({ paidDate: '2025-01-31' }), { today })).toEqual({})
  })

  it('limits notes to 500 characters', () => {
    expect(validatePaymentDraft(draft({ notes: 'a'.repeat(500) }))).toEqual({})
    expect(validatePaymentDraft(draft({ notes: 'a'.repeat(501) })).notes).toBe(
      'Notes must be 500 characters or fewer.',
    )
  })

  describe('allowing zero (the new-entry form)', () => {
    const rules = { today, outstanding: 15750, allowZero: true }

    it('accepts 0 with no date', () => {
      expect(validatePaymentDraft(draft({ amount: 0, paidDate: '' }), rules)).toEqual({})
    })

    it('ignores the date when nothing was paid', () => {
      expect(validatePaymentDraft(draft({ amount: 0, paidDate: '2099-01-01' }), rules)).toEqual({})
    })

    it('requires an amount, explaining 0', () => {
      expect(validatePaymentDraft(draft({ amount: '' }), rules).amount).toBe(
        'Enter the amount paid, or use 0 if nothing was paid.',
      )
    })

    it('still requires a date when something was paid', () => {
      expect(validatePaymentDraft(draft({ amount: 100, paidDate: '' }), rules).paidDate).toBe(
        'Select the date this payment was received.',
      )
    })

    it('still rejects more than the total due', () => {
      expect(validatePaymentDraft(draft({ amount: 16000 }), rules).amount).toBe(
        'Amount cannot exceed the outstanding ₹15,750.',
      )
    })
  })
})

describe('validatePaymentInput', () => {
  const input: PaymentInput = { entryId: 'entry-1', amount: 3000, paidDate: today, notes: '' }

  it('accepts a valid payment', () => {
    expect(validatePaymentInput(input, { today, outstanding: 5750 })).toEqual({})
  })

  it('requires an entry', () => {
    expect(validatePaymentInput({ ...input, entryId: ' ' }).entryId).toBe(
      'The payment has no entry.',
    )
  })

  it('applies the same rules as the form', () => {
    expect(validatePaymentInput({ ...input, amount: 0 }).amount).toBeDefined()
    expect(validatePaymentInput({ ...input, amount: Number.NaN }).amount).toBeDefined()
    expect(validatePaymentInput(input, { outstanding: 100 }).amount).toBeDefined()
  })
})

describe('parsePaymentDraft', () => {
  it('builds the payment input, trimming notes', () => {
    expect(
      parsePaymentDraft('entry-1', draft({ notes: '  Bank transfer  ' }), {
        today,
        outstanding: 5750,
      }),
    ).toEqual({
      ok: true,
      input: { entryId: 'entry-1', amount: 3000, paidDate: today, notes: 'Bank transfer' },
    })
  })

  it('returns the errors for an invalid draft', () => {
    expect(parsePaymentDraft('entry-1', draft({ amount: '' }), { today })).toEqual({
      ok: false,
      errors: { amount: 'Enter the amount received.' },
    })
  })
})

describe('validateReversalReason', () => {
  it('accepts a reason up to 500 characters once trimmed', () => {
    expect(validateReversalReason('Entered ₹10,000 instead of ₹1,000.')).toBeNull()
    expect(validateReversalReason(`  ${'x'.repeat(500)}  `)).toBeNull()
  })

  it('needs a reason', () => {
    expect(validateReversalReason('')).toBe('Say why this payment is being reversed.')
    expect(validateReversalReason(' \n ')).toBe('Say why this payment is being reversed.')
  })

  it('refuses more than 500 characters', () => {
    expect(validateReversalReason('x'.repeat(501))).toBe(
      'The reason must be 500 characters or fewer.',
    )
  })
})
