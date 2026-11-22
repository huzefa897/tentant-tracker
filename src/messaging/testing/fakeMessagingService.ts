import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import type {
  MessagePreview,
  MessageRequest,
  PropertyMessaging,
  SendMessageResult,
} from '@/messaging/types'

// A fake messagingService. `fakeMessaging.status` is what every property answers (on, set up,
// may send by default); a message is answered with `fakeMessaging.outcome`, and each is sent
// once a day like the API (a second for the same bill, or a second dues reminder, is 'conflict'
// already_sent_today; a failed one isn't recorded). A dues reminder's preview is
// `fakeMessaging.preview`, or 'conflict' nothing_owed when it's null. Use it with
//   vi.mock('@/messaging/messaging.service', () => import('@/messaging/testing/fakeMessagingService'))
// and call resetMessagingService() in beforeEach.
export const fakeMessaging: {
  status: PropertyMessaging
  outcome: SendMessageResult
  preview: MessagePreview | null
  sent: string[] // what was sent, in order: a bill reminder's entry id, or 'dues'
} = {
  status: { enabled: true, ready: true, canSend: true },
  outcome: { outcome: 'sent', reason: '' },
  preview: null,
  sent: [],
}

export function makePreview(overrides: Partial<MessagePreview> = {}): MessagePreview {
  return {
    body: 'Hi Test, your rent for August 2026 (no bill yet) and September 2026 (Rs. 15,750) is unpaid.',
    months: [
      { month: '2026-08', dueDate: '2026-08-11', outstanding: null },
      { month: '2026-09', dueDate: '2026-09-11', outstanding: 15750 },
    ],
    billedOutstanding: 15750,
    ...overrides,
  }
}

export const messagingService = {
  getPropertyMessaging: vi.fn(),
  sendMessage: vi.fn(),
  previewMessage: vi.fn(),
}

function conflict(code: string, detail: string) {
  return new ApiError('conflict', 'Conflict', code, {}, { code, detail })
}

function sentKey(request: MessageRequest): string {
  return request.kind === 'bill_reminder' ? request.entryId : 'dues'
}

export function resetMessagingService() {
  fakeMessaging.status = { enabled: true, ready: true, canSend: true }
  fakeMessaging.outcome = { outcome: 'sent', reason: '' }
  fakeMessaging.preview = makePreview()
  fakeMessaging.sent = []
  messagingService.getPropertyMessaging
    .mockReset()
    .mockImplementation(async () => ({ ...fakeMessaging.status }))
  messagingService.sendMessage
    .mockReset()
    .mockImplementation(
      async (_propertyId: string, _tenancyId: string, request: MessageRequest) => {
        const key = sentKey(request)
        if (fakeMessaging.sent.includes(key)) {
          throw conflict(
            'already_sent_today',
            request.kind === 'bill_reminder'
              ? 'A reminder for this bill was already sent today.'
              : 'A reminder for these months was already sent today.',
          )
        }
        if (fakeMessaging.outcome.outcome !== 'failed') fakeMessaging.sent.push(key)
        return { ...fakeMessaging.outcome }
      },
    )
  messagingService.previewMessage.mockReset().mockImplementation(async () => {
    if (!fakeMessaging.preview) {
      throw conflict('nothing_owed', "Nothing is owed: there's no month to remind about.")
    }
    return structuredClone(fakeMessaging.preview)
  })
}

resetMessagingService()
