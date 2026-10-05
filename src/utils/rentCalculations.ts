import type { Payment } from '@/types/payment'
import type { PaymentStatus, RentEntry, RentEntryInput } from '@/types/rentEntry'
import { fromPaise, toPaise } from '@/utils/money'

type Charges = Pick<
  RentEntryInput,
  'rentAmount' | 'electricityUnits' | 'electricityRate' | 'waterAmount'
>

// The backend's rule (billing/calculations.py): electricity is rounded to paise, half up, then
// added to rent and water. Worked in integers (milli-units × paise) so it's exact, not floating
// point. These are previews: saved bills show the figures Django calculated.

// Units consumed × rate per unit. Units beyond three decimals (invalid) are rounded first.
export function calculateElectricity(units: number, rate: number): number {
  const milliUnits = Math.round(units * 1000)
  // Math.round rounds halves up, as Django does for non-negative amounts.
  return fromPaise(Math.round((milliUnits * toPaise(rate)) / 1000))
}

// Rent + electricity + water
export function calculateTotalDue(entry: Charges): number {
  return fromPaise(
    toPaise(entry.rentAmount) +
      toPaise(calculateElectricity(entry.electricityUnits, entry.electricityRate)) +
      toPaise(entry.waterAmount),
  )
}

// Total due − total paid, in paise so the result is exact.
export function calculateOutstanding(totalDue: number, totalPaid: number): number {
  return fromPaise(toPaise(totalDue) - toPaise(totalPaid))
}

export function getPaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  if (toPaise(totalDue) - toPaise(totalPaid) <= 0) return 'paid'
  if (toPaise(totalPaid) === 0) return 'unpaid'
  return 'partially_paid'
}

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
}

export function formatPaymentStatus(status: PaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status]
}

// Total paid for a bill is always the sum of its payment records, added as paise.
export function sumPayments(payments: Pick<Payment, 'amount'>[]): number {
  return fromPaise(payments.reduce((sum, payment) => sum + toPaise(payment.amount), 0))
}

// Newest received first; payments received the same day by when they were recorded.
// Copies first: sort() would reorder the caller's array.
export function sortPaymentsNewestFirst(payments: Payment[]): Payment[] {
  return [...payments].sort(
    (a, b) =>
      b.paidDate.localeCompare(a.paidDate) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.localeCompare(a.id),
  )
}

export interface EntryTotals {
  totalBilled: number
  totalPaid: number
  outstanding: number
}

// Sums the given bills' figures (as the backend calculated them) in paise. Only what's passed
// in: the history page sums the page on screen. The deposit is deliberately not applied: that
// needs a business rule.
export function sumEntryAmounts(
  entries: Pick<RentEntry, 'totalDue' | 'totalPaid' | 'outstanding'>[],
): EntryTotals {
  const paise = entries.reduce(
    (sum, entry) => ({
      totalBilled: sum.totalBilled + toPaise(entry.totalDue),
      totalPaid: sum.totalPaid + toPaise(entry.totalPaid),
      outstanding: sum.outstanding + toPaise(entry.outstanding),
    }),
    { totalBilled: 0, totalPaid: 0, outstanding: 0 },
  )

  return {
    totalBilled: fromPaise(paise.totalBilled),
    totalPaid: fromPaise(paise.totalPaid),
    outstanding: fromPaise(paise.outstanding),
  }
}
