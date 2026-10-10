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

// recorded: counts towards its bill. reversed: corrected by an owner (recorded by mistake), so
// it no longer counts; kept, unchanged, in the history. Reversing moves no money.
export type PaymentRecordStatus = 'recorded' | 'reversed'

// Who reversed a payment, when and why.
export interface PaymentReversal {
  id: string
  reason: string
  createdAt: string // ISO timestamp
  createdByName: string // '' when they have no name
}

// A recorded payment, from the backend. Never edited: a mistake is reversed and a replacement
// recorded.
export interface Payment extends PaymentInput {
  id: string
  createdAt: string // ISO timestamp
  status: PaymentRecordStatus
  reversal: PaymentReversal | null // set when status is 'reversed'
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

// What reversing returns: the payment, now reversed, and its bill's balance without it, as
// Django calculated them. replayed: it had already been reversed for the same reason (a retry).
export interface ReversedPayment {
  payment: Payment
  entry: RentEntry
  replayed: boolean
}
