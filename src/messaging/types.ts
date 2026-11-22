// Messaging, as the app sees it (docs/messaging.md).

// Whether the app offers Send SMS on a property: messaging on there, SMS set up on the server,
// and the person's role may text tenants.
export interface PropertyMessaging {
  enabled: boolean
  ready: boolean
  canSend: boolean
}

// What to text a tenant about, by kind (the backend's messaging/kinds/). Adding a kind means
// one more member here, its kind on the backend and, where it's offered, a summary for the
// confirm dialog; sending, the store and useSendMessage don't change.
export type MessageRequest =
  // One bill: what's outstanding on it.
  | { kind: 'bill_reminder'; entryId: string }
  // Every month the tenant still owes (billing's definition: no bill yet, or money left).
  | { kind: 'dues_reminder' }

export type MessageKind = MessageRequest['kind']

// What came of a text: sent; failed (nothing went, send it again); unknown (it may have gone).
export type MessageOutcome = 'sent' | 'failed' | 'unknown'

// One month in a dues reminder: outstanding on its bill, or null with no bill yet.
export interface OwedMonth {
  month: string // YYYY-MM
  dueDate: string // YYYY-MM-DD
  outstanding: number | null
}

// What a message would say now, before it's sent (kinds that can say: a dues reminder).
export interface MessagePreview {
  body: string
  months: OwedMonth[]
  // The total outstanding on the months' bills; months without one aren't in it.
  billedOutstanding: number
}

export interface SendMessageResult {
  outcome: MessageOutcome
  reason: string
}
