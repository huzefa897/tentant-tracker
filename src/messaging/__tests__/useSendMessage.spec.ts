import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messagingService } from '@/messaging/messaging.service'
import { fakeMessaging, resetMessagingService } from '@/messaging/testing/fakeMessagingService'
import { useSendMessage } from '@/messaging/useSendMessage'
import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/messaging/messaging.service', () => import('@/messaging/testing/fakeMessagingService'))

const BILL_REMINDER = { kind: 'bill_reminder', entryId: 'sep' } as const

async function signedIn() {
  vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty]))
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
  const sms = useSendMessage()
  await flushPromises()
  return sms
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetAuthService()
  resetAccessService()
  resetMessagingService()
})

describe('useSendMessage', () => {
  it("asks whether it's offered on the selected property", async () => {
    const sms = await signedIn()

    expect(messagingService.getPropertyMessaging).toHaveBeenCalledWith(testProperty.id)
    expect(sms.available.value).toBe(true)
    expect(sms.statusFailed.value).toBe(false)
  })

  it("says when that couldn't be loaded, and retries", async () => {
    vi.mocked(messagingService.getPropertyMessaging).mockRejectedValueOnce(
      new ApiError('network', 'down'),
    )
    const sms = await signedIn()
    expect(sms.available.value).toBe(false)
    expect(sms.statusFailed.value).toBe(true)

    sms.retryStatus()
    await flushPromises()

    expect(sms.statusFailed.value).toBe(false)
    expect(sms.available.value).toBe(true)
  })

  it('opens for a message, sends it, closes and says so', async () => {
    const sms = await signedIn()
    sms.start('tenant-001', BILL_REMINDER)
    expect(sms.isOpen.value).toBe(true)
    expect(sms.kind.value).toBe('bill_reminder')

    await expect(sms.send('Meera')).resolves.toBe('SMS reminder sent to Meera.')

    expect(messagingService.sendMessage).toHaveBeenCalledWith(
      testProperty.id,
      'tenant-001',
      BILL_REMINDER,
    )
    expect(sms.isOpen.value).toBe(false)
    expect(sms.notice.value).toBe('SMS reminder sent to Meera.')
  })

  it('keeps the dialog open with the reason when it failed or was refused', async () => {
    const sms = await signedIn()
    fakeMessaging.outcome = { outcome: 'failed', reason: 'Refused.' }
    sms.start('tenant-001', BILL_REMINDER)

    await expect(sms.send('Meera')).resolves.toBeNull()
    expect(sms.isOpen.value).toBe(true)
    expect(sms.error.value).toBe("The SMS wasn't sent: Refused. Try again.")

    fakeMessaging.sent = ['sep']
    fakeMessaging.outcome = { outcome: 'sent', reason: '' }
    await sms.send('Meera')
    expect(sms.error.value).toBe('A reminder for this bill was already sent today.')
    expect(sms.notice.value).toBeNull()
  })

  it("can't be closed while sending", async () => {
    const sms = await signedIn()
    let finish!: () => void
    vi.mocked(messagingService.sendMessage).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ outcome: 'sent', reason: '' })
      }),
    )
    sms.start('tenant-001', BILL_REMINDER)

    const sending = sms.send('Meera')
    sms.isOpen.value = false
    expect(sms.isOpen.value).toBe(true)
    expect(sms.sending.value).toBe(true)

    finish()
    await sending
    expect(sms.isOpen.value).toBe(false)
  })

  it('sends nothing before start, and forgets everything on reset', async () => {
    const sms = await signedIn()
    await expect(sms.send('Meera')).resolves.toBeNull()
    expect(messagingService.sendMessage).not.toHaveBeenCalled()

    sms.start('tenant-001', BILL_REMINDER)
    await sms.send('Meera')
    sms.reset()

    expect(sms.notice.value).toBeNull()
    expect(sms.request.value).toBeNull()
    expect(sms.isOpen.value).toBe(false)
  })

  it('ignores the answer to a send still on its way when reset', async () => {
    const sms = await signedIn()
    let finish!: () => void
    vi.mocked(messagingService.sendMessage).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ outcome: 'sent', reason: '' })
      }),
    )
    sms.start('tenant-001', BILL_REMINDER)
    const sending = sms.send('Meera')

    sms.reset()
    expect(sms.sending.value).toBe(false)
    sms.start('tenant-002', BILL_REMINDER)
    finish()

    await expect(sending).resolves.toBeNull()
    expect(sms.notice.value).toBeNull()
    expect(sms.error.value).toBeNull()
    expect(sms.isOpen.value).toBe(true)
  })

  describe('a kind that previews', () => {
    const DUES = { kind: 'dues_reminder' } as const

    it('loads what it would say, and sends only once it has', async () => {
      const sms = await signedIn()
      sms.start('tenant-001', DUES)
      expect(sms.preview.value.status).toBe('loading')
      expect(sms.canConfirm.value).toBe(false)
      await expect(sms.send('Meera')).resolves.toBeNull()
      expect(messagingService.sendMessage).not.toHaveBeenCalled()

      await flushPromises()
      expect(sms.preview.value).toEqual({ status: 'ready', value: fakeMessaging.preview })
      expect(sms.canConfirm.value).toBe(true)
      await expect(sms.send('Meera')).resolves.toBe('SMS reminder sent to Meera.')
      expect(messagingService.sendMessage).toHaveBeenCalledWith(testProperty.id, 'tenant-001', DUES)
    })

    it('says why there is nothing to send, and loads again on retry', async () => {
      const sms = await signedIn()
      fakeMessaging.preview = null
      sms.start('tenant-001', DUES)
      await flushPromises()
      expect(sms.preview.value).toEqual({
        status: 'error',
        message: "Nothing is owed: there's no month to remind about.",
      })
      expect(sms.canConfirm.value).toBe(false)

      resetMessagingService()
      await sms.loadPreview()
      expect(sms.preview.value.status).toBe('ready')
    })

    it('drops a preview still on its way when reset', async () => {
      const sms = await signedIn()
      sms.start('tenant-001', DUES)
      sms.reset()
      await flushPromises()

      expect(sms.preview.value).toEqual({ status: 'none' })
    })

    it('has no preview for a bill reminder', async () => {
      const sms = await signedIn()
      sms.start('tenant-001', BILL_REMINDER)

      expect(sms.preview.value).toEqual({ status: 'none' })
      expect(sms.canConfirm.value).toBe(true)
      expect(messagingService.previewMessage).not.toHaveBeenCalled()
    })
  })
})
