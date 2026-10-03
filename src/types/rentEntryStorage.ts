import type { RentEntry } from '@/types/rentEntry'

// What's written to localStorage. Versioned so a future change to RentEntry can migrate old
// data deliberately instead of misreading it. Totals stay derived, as in the app.
export interface RentEntryStorage {
  version: 1
  entries: RentEntry[]
}
