// Messaging, as the app sees it (docs/messaging.md).

// Whether the app offers Send SMS on a property: messaging on there, SMS set up on the server,
// and the person's role may text tenants.
export interface PropertyMessaging {
  enabled: boolean
  ready: boolean
  canSend: boolean
}

// What came of a text: sent; failed (nothing went, send it again); unknown (it may have gone).
export type MessageOutcome = 'sent' | 'failed' | 'unknown'

export interface BillReminderResult {
  outcome: MessageOutcome
  reason: string
}
