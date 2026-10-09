import type { ReceiptSummary } from '@/types/receipt'
import type { RentEntry } from '@/types/rentEntry'

// Money received against one bill (RentEntry). A bill can have several payments; they are
// never allocated across months automatically.
export interface PaymentInput {
  entryId: string
  amount: number
  paidDate: string // YYYY-MM-DD, the day the money was received
  notes: string
}

// A recorded payment, from the backend. Read-only: editing and reversing payments need their
// own rules.
export interface Payment extends PaymentInput {
  id: string
  createdAt: string // ISO timestamp
  receipt: ReceiptSummary | null // null until one is issued
}

// What recording a payment returns: the payment and its bill's balance after it, as Django
// calculated them. replayed: the request was a retry of a payment already recorded (nothing
// new was recorded); the bill's balance is the current one, which may include later payments.
export interface RecordedPayment {
  payment: Payment
  entry: RentEntry
  replayed: boolean
}
