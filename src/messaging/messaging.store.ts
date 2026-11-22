import { defineStore } from 'pinia'
import { ref } from 'vue'

import { ApiError, RATE_LIMITED_MESSAGE, isUncertainFailure } from '@/services/apiError'
import { messagingService } from '@/messaging/messaging.service'
import { useAccessStore } from '@/stores/access'
import type { MessageRequest, PropertyMessaging, SendMessageResult } from '@/messaging/types'
import { SEND_ERROR_MESSAGE, SEND_UNCONFIRMED_MESSAGE } from '@/messaging/utils/wording'

export class MessageSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessageSendError'
  }
}

type MessagingStatus =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: PropertyMessaging }

// Messaging for the selected property: whether the app offers Send SMS, and sending a message
// of any kind. The backend decides both; nothing here is a rule of its own.
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

  // The property's answer couldn't be loaded, so whether Send SMS is offered isn't known: the
  // page says so rather than quietly leaving the button out.
  function loadFailed(propertyId: string | null): boolean {
    return Boolean(propertyId) && byProperty.value[propertyId as string]?.status === 'error'
  }

  // Offered only once the backend has said so: on, set up, and the role may send.
  function canSendFor(propertyId: string | null): boolean {
    const entry = propertyId ? byProperty.value[propertyId] : undefined
    if (entry?.status !== 'ready') return false
    const { enabled, ready, canSend } = entry.value
    return enabled && ready && canSend
  }

  // Throws MessageSendError when nothing was sent (or it's unconfirmed); otherwise returns the
  // message's outcome, which may be 'failed' or 'unknown'.
  async function send(tenantId: string, request: MessageRequest): Promise<SendMessageResult> {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) throw new MessageSendError('Choose a property first.')
    try {
      return await messagingService.sendMessage(propertyId, tenantId, request)
    } catch (error) {
      throw new MessageSendError(errorMessage(error))
    }
  }

  function reset() {
    inFlight.clear() // an answer for the person signed out is dropped
    byProperty.value = {}
  }

  return { byProperty, load, loadFailed, canSendFor, send, reset }
})

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Nothing was sent: the backend says why, in words for people (messaging/sending.py and
    // the kind's own reasons).
    if (error.kind === 'conflict' && error.code) {
      const detail = error.details.detail
      return typeof detail === 'string' && detail.trim() ? detail : SEND_ERROR_MESSAGE
    }
    if (error.kind === 'forbidden') return 'Only owners and managers can text tenants.'
    if (error.kind === 'rate-limited') return RATE_LIMITED_MESSAGE
  }
  return isUncertainFailure(error) ? SEND_UNCONFIRMED_MESSAGE : SEND_ERROR_MESSAGE
}
