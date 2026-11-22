import { defineStore } from 'pinia'
import { ref } from 'vue'

import { ApiError, RATE_LIMITED_MESSAGE, isUncertainFailure } from '@/services/apiError'
import { messagingService } from '@/services/messaging.service'
import { useAccessStore } from '@/stores/access'
import type { BillReminderResult, PropertyMessaging } from '@/types/messaging'

export const REMINDER_ERROR_MESSAGE = "The SMS couldn't be sent. Try again."
export const REMINDER_UNCONFIRMED_MESSAGE =
  "We couldn't confirm the SMS was sent. Trying again won't text the tenant twice today."

// What nothing-was-sent means, in the app's words, by the backend's code.
const REFUSALS: Record<string, string> = {
  messaging_off: 'Messaging is off for this property.',
  server_off: 'Messaging is off on the server.',
  provider_not_set_up: "SMS isn't set up on the server yet.",
  entry_void: 'This bill is void: it owes nothing.',
  entry_paid: 'This bill is paid: nothing is outstanding.',
  number_untextable: "The tenant's mobile number can't be texted. Check it on their page.",
  no_rental_period: 'This bill has no due date to remind about.',
  already_sent_today: 'A reminder for this bill was already sent today.',
}

export class ReminderSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReminderSendError'
  }
}

type MessagingStatus =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: PropertyMessaging }

// Messaging for the selected property: whether the app offers Send SMS, and sending a bill's
// reminder. The backend decides both; nothing here is a rule of its own.
export const useMessagingStore = defineStore('messaging', () => {
  const accessStore = useAccessStore()
  const byProperty = ref<Record<string, MessagingStatus>>({})
  // Each property's request on its way, with a token telling it apart from a later one.
  const inFlight = new Map<string, { token: symbol; request: Promise<void> }>()

  // Asked again on each visit, since admin can turn messaging on or off at any time; what was
  // known stays shown meanwhile. One request per property at a time.
  function load(propertyId: string): Promise<void> {
    const pending = inFlight.get(propertyId)
    if (pending) return pending.request
    if (byProperty.value[propertyId]?.status !== 'ready') {
      byProperty.value[propertyId] = { status: 'loading' }
    }
    const token = Symbol(propertyId)
    const current = () => inFlight.get(propertyId)?.token === token
    const request = (async () => {
      let next: MessagingStatus
      try {
        next = { status: 'ready', value: await messagingService.getPropertyMessaging(propertyId) }
      } catch {
        next = { status: 'error' }
      }
      // Dropped when reset (signed out) while it was on its way.
      if (current()) {
        byProperty.value[propertyId] = next
        inFlight.delete(propertyId)
      }
    })()
    inFlight.set(propertyId, { token, request })
    return request
  }

  // Offered only once the backend has said so: on, set up, and the role may send.
  function canSendFor(propertyId: string | null): boolean {
    const entry = propertyId ? byProperty.value[propertyId] : undefined
    if (entry?.status !== 'ready') return false
    const { enabled, ready, canSend } = entry.value
    return enabled && ready && canSend
  }

  // Throws ReminderSendError when nothing was sent (or it's unconfirmed); otherwise returns the
  // message's outcome, which may be 'failed' or 'unknown'.
  async function sendBillReminder(tenantId: string, entryId: string): Promise<BillReminderResult> {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) throw new ReminderSendError('Choose a property first.')
    try {
      return await messagingService.sendBillReminder(propertyId, tenantId, entryId)
    } catch (error) {
      throw new ReminderSendError(errorMessage(error))
    }
  }

  function reset() {
    inFlight.clear() // an answer for the person signed out is dropped
    byProperty.value = {}
  }

  return { byProperty, load, canSendFor, sendBillReminder, reset }
})

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const refusal = error.kind === 'conflict' && error.code ? REFUSALS[error.code] : undefined
    if (refusal) return refusal
    if (error.kind === 'forbidden') return 'Only owners and managers can text tenants.'
    if (error.kind === 'rate-limited') return RATE_LIMITED_MESSAGE
  }
  return isUncertainFailure(error) ? REMINDER_UNCONFIRMED_MESSAGE : REMINDER_ERROR_MESSAGE
}
