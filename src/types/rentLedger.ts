import type { Payment } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import type { RentEntry } from '@/types/rentEntry'

// Bills, the payments against them and the receipts issued for those payments, always read
// and written together.
export interface RentLedger {
  entries: RentEntry[]
  payments: Payment[]
  receipts: PaymentReceipt[]
}

// What's written to localStorage. Versioned so a change to the data can migrate old data
// deliberately instead of misreading it. Totals stay derived, as in the app.
export interface RentLedgerStorage extends RentLedger {
  version: 3
}
