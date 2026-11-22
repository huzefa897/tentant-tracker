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
export type MessageRequest = { kind: 'bill_reminder'; entryId: string }

export type MessageKind = MessageRequest['kind']

// What came of a text: sent; failed (nothing went, send it again); unknown (it may have gone).
export type MessageOutcome = 'sent' | 'failed' | 'unknown'

export interface SendMessageResult {
  outcome: MessageOutcome
  reason: string
}
