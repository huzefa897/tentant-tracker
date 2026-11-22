import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type {
  MessageOutcome,
  MessageRequest,
  PropertyMessaging,
  SendMessageResult,
} from '@/messaging/types'

const OUTCOMES: readonly MessageOutcome[] = ['sent', 'failed', 'unknown']

function invalid(what: string): never {
  throw new ApiError('invalid-response', `Unexpected ${what} in messaging response`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function propertyUrl(propertyId: string) {
  return `/properties/${encodeURIComponent(propertyId)}`
}

export const messagingService = {
  // GET /properties/{id}/messaging/: whether Send SMS is offered there.
  async getPropertyMessaging(propertyId: string): Promise<PropertyMessaging> {
    let response
    try {
      response = await api.get(`${propertyUrl(propertyId)}/messaging/`)
    } catch (error) {
      throw toApiError(error)
    }
    const data: unknown = response.data
    if (!isRecord(data)) invalid('body')
    const { enabled, ready, canSend } = data
    if (typeof enabled !== 'boolean') invalid('enabled')
    if (typeof ready !== 'boolean') invalid('ready')
    if (typeof canSend !== 'boolean') invalid('canSend')
    return { enabled, ready, canSend }
  },

  // POST .../tenancies/{id}/messages/: texts the tenant one message of this kind now (a bill's
  // reminder: { kind: 'bill_reminder', entryId }). Errors: 'forbidden'; 'invalid-request' (an
  // unknown kind or a missing field); 'not-found' (another tenancy's bill); 'conflict' with a
  // code when nothing was sent: 'messaging_off', 'server_off', 'provider_not_set_up',
  // 'number_untextable', or the kind's own ('entry_void', 'entry_paid', 'no_rental_period',
  // 'already_sent_today'). Each kind guards against sending twice (a bill's reminder: one a
  // day), so retrying after no answer can't text twice.
  async sendMessage(
    propertyId: string,
    tenancyId: string,
    request: MessageRequest,
  ): Promise<SendMessageResult> {
    let response
    try {
      response = await api.post(
        `${propertyUrl(propertyId)}/tenancies/${encodeURIComponent(tenancyId)}/messages/`,
        request,
      )
    } catch (error) {
      throw toApiError(error)
    }
    const data: unknown = response.data
    if (!isRecord(data)) invalid('body')
    const { status, reason } = data
    if (typeof status !== 'string' || !OUTCOMES.includes(status as MessageOutcome)) {
      invalid('status')
    }
    if (typeof reason !== 'string') invalid('reason')
    return { outcome: status as MessageOutcome, reason }
  },
}
