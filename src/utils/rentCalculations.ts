import type { PaymentStatus, RentEntryInput } from '@/types/rentEntry'

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

// Total due − total paid
export function calculateOutstanding(totalDue: number, totalPaid: number): number {
  return roundMoney(totalDue - totalPaid)
}

export function getPaymentStatus(totalDue: number, totalPaid: number): PaymentStatus {
  const outstanding = calculateOutstanding(totalDue, totalPaid)

  if (outstanding === 0) return 'paid'
  if (totalPaid === 0) return 'unpaid'
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
