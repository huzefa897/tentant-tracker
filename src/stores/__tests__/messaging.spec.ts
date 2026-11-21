import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService } from '@/services/access.service'
import { ApiError, RATE_LIMITED_MESSAGE } from '@/services/apiError'
import { messagingService } from '@/services/messaging.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import {
  REMINDER_ERROR_MESSAGE,
  REMINDER_UNCONFIRMED_MESSAGE,
  ReminderSendError,
  useMessagingStore,
} from '@/stores/messaging'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeMessaging, resetMessagingService } from '@/test/mocks/messagingService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/messaging.service', () => import('@/test/mocks/messagingService'))

const getPropertyMessaging = vi.mocked(messagingService.getPropertyMessaging)
const sendBillReminder = vi.mocked(messagingService.sendBillReminder)

async function withProperty() {
  vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty]))
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
  return useMessagingStore()
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetAuthService()
  resetAccessService()
  resetMessagingService()
})

describe('useMessagingStore', () => {
  describe('canSendFor', () => {
    it('offers sending once the backend says on, set up and allowed', async () => {
      const store = useMessagingStore()
      expect(store.canSendFor(testProperty.id)).toBe(false)

      await store.load(testProperty.id)

      expect(store.canSendFor(testProperty.id)).toBe(true)
      expect(store.canSendFor(null)).toBe(false)
      expect(store.canSendFor('another')).toBe(false)
    })

    it.each([
      { enabled: false, ready: true, canSend: true },
      { enabled: true, ready: false, canSend: true },
      { enabled: true, ready: true, canSend: false },
    ])('offers nothing when %j', async (status) => {
      fakeMessaging.status = status
      const store = useMessagingStore()
      await store.load(testProperty.id)
      expect(store.canSendFor(testProperty.id)).toBe(false)
    })

    it('offers nothing when loading fails, and loads again next time', async () => {
      getPropertyMessaging.mockRejectedValueOnce(new ApiError('network', 'down'))
      const store = useMessagingStore()

      await store.load(testProperty.id)
      expect(store.canSendFor(testProperty.id)).toBe(false)

      await store.load(testProperty.id)
      expect(store.canSendFor(testProperty.id)).toBe(true)
    })

    it('loads a property once, and again after reset', async () => {
      const store = useMessagingStore()
      await store.load(testProperty.id)
      await store.load(testProperty.id)
      expect(getPropertyMessaging).toHaveBeenCalledTimes(1)

      store.reset()
      expect(store.canSendFor(testProperty.id)).toBe(false)
      await store.load(testProperty.id)
      expect(getPropertyMessaging).toHaveBeenCalledTimes(2)
    })
  })

  describe('sendBillReminder', () => {
    it('sends for the selected property and returns the outcome', async () => {
      const store = await withProperty()

      await expect(store.sendBillReminder('tenant-001', 'sep')).resolves.toEqual({
        outcome: 'sent',
        reason: '',
      })
      expect(sendBillReminder).toHaveBeenCalledWith(testProperty.id, 'tenant-001', 'sep')
    })

    it('needs a property', async () => {
      const store = useMessagingStore()
      await expect(store.sendBillReminder('tenant-001', 'sep')).rejects.toThrow(
        'Choose a property first.',
      )
      expect(sendBillReminder).not.toHaveBeenCalled()
    })

    it.each([
      [
        new ApiError('conflict', 'x', 'already_sent_today'),
        'A reminder for this bill was already sent today.',
      ],
      [
        new ApiError('conflict', 'x', 'number_untextable'),
        "The tenant's mobile number can't be texted. Check it on their page.",
      ],
      [new ApiError('conflict', 'x', 'something_new'), REMINDER_ERROR_MESSAGE],
      [new ApiError('forbidden', 'x'), 'Only owners and managers can text tenants.'],
      [new ApiError('rate-limited', 'x'), RATE_LIMITED_MESSAGE],
      [new ApiError('network', 'x'), REMINDER_UNCONFIRMED_MESSAGE],
    ])('explains %s', async (error, message) => {
      const store = await withProperty()
      sendBillReminder.mockRejectedValueOnce(error)

      const thrown = await store.sendBillReminder('tenant-001', 'sep').catch((e) => e)

      expect(thrown).toBeInstanceOf(ReminderSendError)
      expect(thrown.message).toBe(message)
    })
  })
})
