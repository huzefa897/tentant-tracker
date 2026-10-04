// Money received against one bill (RentEntry). A bill can have several payments; they are
// never allocated across months automatically.
export interface PaymentInput {
  entryId: string
  amount: number
  paidDate: string // YYYY-MM-DD, the day the money was received
  notes: string
}

export interface Payment extends PaymentInput {
  id: string
  createdAt: string // ISO timestamp
}
