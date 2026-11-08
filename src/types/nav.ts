// The app's top-level sections, one per item in the bottom nav (Record is an action, not one).
export type NavSection = 'home' | 'tenants' | 'account'

export interface NavLink {
  section: NavSection
  label: string
  // The resolved URL, so each item is a real link (open in a new tab, long-press to copy).
  href: string
}

// What the + Record button starts, once a tenant is chosen.
export type RecordKind = 'bill' | 'reading'
