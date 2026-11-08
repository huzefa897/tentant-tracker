// The app's top-level sections, one per item in the bottom nav (Quick entry is an action, not one).
export type NavSection = 'home' | 'tenants' | 'account'

export interface NavLink {
  section: NavSection
  label: string
  // The resolved URL, so each item is a real link (open in a new tab, long-press to copy).
  href: string
}

// What Quick entry records: a bill, a payment (on one of the tenant's bills) or a meter reading.
export type RecordKind = 'bill' | 'payment' | 'reading'

// The sheet's steps. Each is a history entry (see `AppLayout`), so the browser's back goes to
// the one before, then closes the sheet.
export type QuickEntryStep = 'kind' | 'tenant' | 'month' | 'charges' | 'payment' | 'confirm'

// The steps of the New bill form when Quick entry shows it one at a time (RentEntryForm `wizard`).
export type WizardStep = 'charges' | 'payment' | 'confirm'
