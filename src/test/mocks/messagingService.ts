import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import type { BillReminderResult, PropertyMessaging } from '@/types/messaging'

// A fake messagingService. `fakeMessaging.status` is what every property answers (on, set up,
// may send by default); a bill's reminder is sent once a day like the API (a second is
// 'conflict' already_sent_today), answering `fakeMessaging.outcome`. Use it with
//   vi.mock('@/services/messaging.service', () => import('@/test/mocks/messagingService'))
// and call resetMessagingService() in beforeEach.
export const fakeMessaging: {
  status: PropertyMessaging
  outcome: BillReminderResult
  sent: string[] // entry ids, in order
} = {
  status: { enabled: true, ready: true, canSend: true },
  outcome: { outcome: 'sent', reason: '' },
  sent: [],
}

export const messagingService = {
  getPropertyMessaging: vi.fn(),
  sendBillReminder: vi.fn(),
}

export function resetMessagingService() {
  fakeMessaging.status = { enabled: true, ready: true, canSend: true }
  fakeMessaging.outcome = { outcome: 'sent', reason: '' }
  fakeMessaging.sent = []
  messagingService.getPropertyMessaging
    .mockReset()
    .mockImplementation(async () => ({ ...fakeMessaging.status }))
  messagingService.sendBillReminder
    .mockReset()
    .mockImplementation(async (_propertyId: string, _tenancyId: string, entryId: string) => {
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
    })
}

resetMessagingService()
