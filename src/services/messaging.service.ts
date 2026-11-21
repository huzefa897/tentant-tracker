import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import type { BillReminderResult, MessageOutcome, PropertyMessaging } from '@/types/messaging'

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

  // Texts the tenant a reminder about this bill now. Errors: 'forbidden'; 'conflict' with code
  // 'messaging_off', 'provider_not_set_up', 'entry_void', 'entry_paid', 'number_untextable',
  // 'no_rental_period' or 'already_sent_today' (nothing was sent). At most one a day per bill,
  // so retrying after no answer can't text twice.
  async sendBillReminder(
    propertyId: string,
    tenancyId: string,
    entryId: string,
  ): Promise<BillReminderResult> {
    let response
    try {
      response = await api.post(
        `${propertyUrl(propertyId)}/tenancies/${encodeURIComponent(tenancyId)}/entries/${encodeURIComponent(entryId)}/reminder/`,
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
