import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService } from '@/services/access.service'
import { ApiError, RATE_LIMITED_MESSAGE } from '@/services/apiError'
import { messagingService } from '@/messaging/messaging.service'
import { MessageSendError, useMessagingStore } from '@/messaging/messaging.store'
import {
  PREVIEW_ERROR_MESSAGE,
  SEND_ERROR_MESSAGE,
  SEND_UNCONFIRMED_MESSAGE,
} from '@/messaging/utils/wording'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeMessaging, resetMessagingService } from '@/messaging/testing/fakeMessagingService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/messaging/messaging.service', () => import('@/messaging/testing/fakeMessagingService'))

const getPropertyMessaging = vi.mocked(messagingService.getPropertyMessaging)
const sendMessage = vi.mocked(messagingService.sendMessage)
const BILL_REMINDER = { kind: 'bill_reminder', entryId: 'sep' } as const

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
      expect(store.loadFailed(testProperty.id)).toBe(true)

      await store.load(testProperty.id)
      expect(store.canSendFor(testProperty.id)).toBe(true)
      expect(store.loadFailed(testProperty.id)).toBe(false)
    })

    it('asks again on each visit, so a change in admin shows, keeping the answer meanwhile', async () => {
      const store = useMessagingStore()
      await store.load(testProperty.id)
      expect(store.canSendFor(testProperty.id)).toBe(true)

      fakeMessaging.status = { enabled: false, ready: true, canSend: true }
      const reload = store.load(testProperty.id)
      expect(store.canSendFor(testProperty.id)).toBe(true)
      await reload

      expect(store.canSendFor(testProperty.id)).toBe(false)
      expect(getPropertyMessaging).toHaveBeenCalledTimes(2)
    })

    it('sends one request at a time per property', async () => {
      const store = useMessagingStore()
      await Promise.all([store.load(testProperty.id), store.load(testProperty.id)])

      expect(getPropertyMessaging).toHaveBeenCalledTimes(1)
    })

    it('forgets everything on reset, an answer still on its way included', async () => {
      const store = useMessagingStore()
      const loading = store.load(testProperty.id)
      store.reset()
      await loading

      expect(store.canSendFor(testProperty.id)).toBe(false)
    })
  })

  describe('send', () => {
    it('sends for the selected property and returns the outcome', async () => {
      const store = await withProperty()

      await expect(store.send('tenant-001', BILL_REMINDER)).resolves.toEqual({
        outcome: 'sent',
        reason: '',
      })
      expect(sendMessage).toHaveBeenCalledWith(testProperty.id, 'tenant-001', BILL_REMINDER)
    })

    it('needs a property', async () => {
      const store = useMessagingStore()
      await expect(store.send('tenant-001', BILL_REMINDER)).rejects.toThrow(
        'Choose a property first.',
      )
      expect(sendMessage).not.toHaveBeenCalled()
    })

    it.each([
      [
        new ApiError(
          'conflict',
          'x',
          'already_sent_today',
          {},
          {
            detail: 'A reminder for this bill was already sent today.',
          },
        ),
        'A reminder for this bill was already sent today.',
      ],
      [
        new ApiError('conflict', 'x', 'something_new', {}, { detail: 'A reason added later.' }),
        'A reason added later.',
      ],
      [new ApiError('conflict', 'x', 'something_new'), SEND_ERROR_MESSAGE],
      [new ApiError('forbidden', 'x'), 'Only owners and managers can text tenants.'],
      [new ApiError('rate-limited', 'x'), RATE_LIMITED_MESSAGE],
      [new ApiError('network', 'x'), SEND_UNCONFIRMED_MESSAGE],
    ])('explains %s', async (error, message) => {
      const store = await withProperty()
      sendMessage.mockRejectedValueOnce(error)

      const thrown = await store.send('tenant-001', BILL_REMINDER).catch((e) => e)

      expect(thrown).toBeInstanceOf(MessageSendError)
      expect(thrown.message).toBe(message)
    })
  })

  describe('preview', () => {
    const DUES = { kind: 'dues_reminder' } as const

    it('asks for the selected property', async () => {
      const store = await withProperty()

      await expect(store.preview('tenant-001', DUES)).resolves.toEqual(fakeMessaging.preview)
      expect(messagingService.previewMessage).toHaveBeenCalledWith(
        testProperty.id,
        'tenant-001',
        DUES,
      )
    })

    it("says why there's nothing to send, or that it couldn't load", async () => {
      const store = await withProperty()
      fakeMessaging.preview = null
      await expect(store.preview('tenant-001', DUES)).rejects.toThrow(
        "Nothing is owed: there's no month to remind about.",
      )

      vi.mocked(messagingService.previewMessage).mockRejectedValueOnce(new ApiError('network', 'x'))
      const thrown = await store.preview('tenant-001', DUES).catch((e) => e)
      expect(thrown).toBeInstanceOf(MessageSendError)
      expect(thrown.message).toBe(PREVIEW_ERROR_MESSAGE)
    })
  })
})
