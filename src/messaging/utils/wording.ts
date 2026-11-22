import type { MessageKind, SendMessageResult } from '@/messaging/types'

export const SEND_ERROR_MESSAGE = "The SMS couldn't be sent. Try again."
export const SEND_UNCONFIRMED_MESSAGE =
  "We couldn't confirm the SMS was sent. Trying again won't text the tenant twice today."
export const STATUS_ERROR_MESSAGE = "Couldn't check whether an SMS can be sent."

interface KindWording {
  // The confirm dialog's title and description, and the note above its buttons.
  title: string
  description: string
  note: string
  // Said once it's sent, to whom.
  sent: (name: string) => string
  // Said when it may have gone: the backend couldn't confirm it.
  unconfirmed: string
}

// What each kind of message says in the app. The text tenants get is the backend's.
const WORDING: Record<MessageKind, KindWording> = {
  bill_reminder: {
    title: 'Send SMS reminder',
    description: 'Text the tenant about this bill now.',
    note: "They'll get an SMS on their mobile number saying what's outstanding for this month and whether it's due or overdue. One a day per bill.",
    sent: (name) => `SMS reminder sent to ${name}.`,
    unconfirmed:
      "The SMS may not have gone out: it wasn't confirmed. It won't be sent again today.",
  },
}

export function kindWording(kind: MessageKind): KindWording {
  return WORDING[kind]
}

// A failed send, in words: the backend's reason when it gave one.
export function failedSendMessage(reason: string): string {
  return reason.trim() ? `The SMS wasn't sent: ${reason.trim()} Try again.` : SEND_ERROR_MESSAGE
}

// What to say once the backend has answered with a send that went (or may have): null for a
// failed one, which keeps the dialog open with failedSendMessage.
export function outcomeNotice(
  kind: MessageKind,
  result: SendMessageResult,
  name: string,
): string | null {
  if (result.outcome === 'failed') return null
  const wording = kindWording(kind)
  return result.outcome === 'sent' ? wording.sent(name) : wording.unconfirmed
}
