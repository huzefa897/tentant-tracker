import type { Payment } from '@/types/payment'
import type { RentEntry } from '@/types/rentEntry'

// Bills and the payments against them, always read and written together.
export interface RentLedger {
  entries: RentEntry[]
  payments: Payment[]
}

// What's written to localStorage. Versioned so a change to the data can migrate old data
// deliberately instead of misreading it. Totals stay derived, as in the app.
export interface RentLedgerStorage extends RentLedger {
  version: 2
}
