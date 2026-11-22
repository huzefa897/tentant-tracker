import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import type { MessageRequest, PropertyMessaging, SendMessageResult } from '@/messaging/types'

// A fake messagingService. `fakeMessaging.status` is what every property answers (on, set up,
// may send by default); a message is answered with `fakeMessaging.outcome`, and a bill's
// reminder is sent once a day like the API (a second is 'conflict' already_sent_today). Use it
//   vi.mock('@/messaging/messaging.service', () => import('@/messaging/testing/fakeMessagingService'))
// and call resetMessagingService() in beforeEach.
export const fakeMessaging: {
  status: PropertyMessaging
  outcome: SendMessageResult
  sent: string[] // bill reminders' entry ids, in order
} = {
  status: { enabled: true, ready: true, canSend: true },
  outcome: { outcome: 'sent', reason: '' },
  sent: [],
}

export const messagingService = {
  getPropertyMessaging: vi.fn(),
  sendMessage: vi.fn(),
}

export function resetMessagingService() {
  fakeMessaging.status = { enabled: true, ready: true, canSend: true }
  fakeMessaging.outcome = { outcome: 'sent', reason: '' }
  fakeMessaging.sent = []
  messagingService.getPropertyMessaging
    .mockReset()
    .mockImplementation(async () => ({ ...fakeMessaging.status }))
  messagingService.sendMessage
    .mockReset()
    .mockImplementation(
      async (_propertyId: string, _tenancyId: string, request: MessageRequest) => {
        const { entryId } = request
        if (fakeMessaging.sent.includes(entryId)) {
          throw new ApiError(
            'conflict',
            'Conflict',
            'already_sent_today',
            {},
            {
              code: 'already_sent_today',
              detail: 'A reminder for this bill was already sent today.',
            },
          )
        }
        if (fakeMessaging.outcome.outcome !== 'failed') fakeMessaging.sent.push(entryId)
        return { ...fakeMessaging.outcome }
      },
    )
}

resetMessagingService()
