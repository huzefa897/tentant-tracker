// Payment rules, used by the payment forms for inline errors, by the store before saving and
// when loading saved payments.

import type { PaymentInput } from '@/types/payment'
import { formatINR } from '@/utils/currency'
import { isValidDateValue } from '@/utils/date'
import { hasAtMostTwoDecimals, toPaise } from '@/utils/money'
import {
  NOTES_MAX_LENGTH,
  type NumberInputValue,
  toAmount,
  withoutPassingChecks,
} from '@/utils/rentEntryValidation'

// The unfinished payment, as typed.
export interface PaymentDraft {
  amount: NumberInputValue
  paidDate: string
  notes: string
}

export type PaymentErrors = Partial<Record<keyof PaymentDraft | 'entryId', string>>

export interface PaymentRules {
  // "YYYY-MM-DD" in local time. Without it, future paid dates aren't checked (used for stored
  // payments, which were checked when saved; the clock may have moved since).
  today?: string
  // The most this payment may be. Omitted when loading: the ledger checks each bill's sum.
  outstanding?: number
  // For the new-entry form, where 0 means "nothing paid yet" and needs no date.
  allowZero?: boolean
}

export function validatePaymentDraft(draft: PaymentDraft, rules: PaymentRules = {}): PaymentErrors {
  const errors: PaymentErrors = {}
  const amount = toAmount(draft.amount)

  if (amount === null) {
    errors.amount = rules.allowZero
      ? 'Enter the amount paid, or use 0 if nothing was paid.'
      : 'Enter the amount received.'
  } else if (amount < 0) {
    errors.amount = 'Amount cannot be negative.'
  } else if (amount === 0 && !rules.allowZero) {
    errors.amount = 'Enter an amount greater than zero.'
  } else if (!hasAtMostTwoDecimals(amount)) {
    errors.amount = 'Amount can have at most two decimal places.'
  } else if (rules.outstanding !== undefined && toPaise(amount) > toPaise(rules.outstanding)) {
    errors.amount =
      toPaise(rules.outstanding) <= 0
        ? 'This bill is already fully paid.'
        : `Amount cannot exceed the outstanding ${formatINR(rules.outstanding)}.`
  }

  // A date is needed whenever money was (or may be) received.
  const nothingPaid = rules.allowZero && (amount === null || amount <= 0)
  if (!nothingPaid) {
    if (!isValidDateValue(draft.paidDate)) {
      errors.paidDate = 'Select the date this payment was received.'
    } else if (rules.today !== undefined && draft.paidDate > rules.today) {
      errors.paidDate = 'Paid date cannot be in the future.'
    }
  }

  if (draft.notes.length > NOTES_MAX_LENGTH) {
    errors.notes = `Notes must be ${NOTES_MAX_LENGTH} characters or fewer.`
  }

  return withoutPassingChecks(errors)
}

// The same rules for a complete payment, before saving it and when loading saved payments.
export function validatePaymentInput(
  input: PaymentInput,
  rules: Omit<PaymentRules, 'allowZero'> = {},
): PaymentErrors {
  const errors = validatePaymentDraft(input, rules)

  if (input.entryId.trim() === '') {
    errors.entryId = 'The payment has no entry.'
  }

  return errors
}

export type ParsedPayment = { ok: true; input: PaymentInput } | { ok: false; errors: PaymentErrors }

export function parsePaymentDraft(
  entryId: string,
  draft: PaymentDraft,
  rules: Omit<PaymentRules, 'allowZero'>,
): ParsedPayment {
  const errors = validatePaymentDraft(draft, rules)
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    input: {
      entryId,
      // Validation guarantees a finite number.
      amount: draft.amount as number,
      paidDate: draft.paidDate,
      notes: draft.notes.trim(),
    },
  }
}
