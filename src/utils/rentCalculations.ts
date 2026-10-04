import type { Payment } from '@/types/payment'
import type { PaymentStatus, RentEntryInput } from '@/types/rentEntry'
import { fromPaise, toPaise } from '@/utils/money'

type Charges = Pick<
  RentEntryInput,
  'rentAmount' | 'electricityUnits' | 'electricityRate' | 'waterAmount'
>

// Good enough for this frontend prototype. Real money should be decimal arithmetic or
// integer paise, recalculated on the backend.
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// Units consumed × rate per unit
export function calculateElectricity(units: number, rate: number): number {
  return roundMoney(units * rate)
}

// Rent + electricity + water
export function calculateTotalDue(entry: Charges): number {
  return roundMoney(
    entry.rentAmount +
      calculateElectricity(entry.electricityUnits, entry.electricityRate) +
      entry.waterAmount,
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

export interface EntryAmounts {
  totalDue: number
  totalPaid: number
  outstanding: number
  status: PaymentStatus
}

// Everything derived for one bill, so every screen calculates it the same way.
// `totalPaid` comes from the bill's payments (sumPayments / the store's getTotalPaid).
export function getEntryAmounts(entry: Charges, totalPaid: number): EntryAmounts {
  const totalDue = calculateTotalDue(entry)

  return {
    totalDue,
    totalPaid,
    outstanding: calculateOutstanding(totalDue, totalPaid),
    status: getPaymentStatus(totalDue, totalPaid),
  }
}

// A bill with what has been paid against it, as the history screens list it.
export interface BilledEntry<T extends Charges = Charges> {
  entry: T
  totalPaid: number
}

export interface EntryTotals {
  totalBilled: number
  totalPaid: number
  outstanding: number
}

// Sums the given bills only. The deposit is deliberately not applied: that needs a business rule.
export function sumEntryAmounts(bills: BilledEntry[]): EntryTotals {
  const paise = bills.reduce(
    (sum, bill) => {
      const amounts = getEntryAmounts(bill.entry, bill.totalPaid)
      return {
        totalBilled: sum.totalBilled + toPaise(amounts.totalDue),
        totalPaid: sum.totalPaid + toPaise(amounts.totalPaid),
        outstanding: sum.outstanding + toPaise(amounts.outstanding),
      }
    },
    { totalBilled: 0, totalPaid: 0, outstanding: 0 },
  )

  return {
    totalBilled: fromPaise(paise.totalBilled),
    totalPaid: fromPaise(paise.totalPaid),
    outstanding: fromPaise(paise.outstanding),
  }
}
