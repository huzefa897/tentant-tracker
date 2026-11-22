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
    sms.start(BILL_REMINDER)
    expect(sms.isOpen.value).toBe(true)
    expect(sms.kind.value).toBe('bill_reminder')

    await expect(sms.send('tenant-001', 'Meera')).resolves.toBe('SMS reminder sent to Meera.')

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
    sms.start(BILL_REMINDER)

    await expect(sms.send('tenant-001', 'Meera')).resolves.toBeNull()
    expect(sms.isOpen.value).toBe(true)
    expect(sms.error.value).toBe("The SMS wasn't sent: Refused. Try again.")

    fakeMessaging.sent = ['sep']
    fakeMessaging.outcome = { outcome: 'sent', reason: '' }
    await sms.send('tenant-001', 'Meera')
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
    sms.start(BILL_REMINDER)

    const sending = sms.send('tenant-001', 'Meera')
    sms.isOpen.value = false
    expect(sms.isOpen.value).toBe(true)
    expect(sms.sending.value).toBe(true)

    finish()
    await sending
    expect(sms.isOpen.value).toBe(false)
  })

  it('sends nothing before start, and forgets everything on reset', async () => {
    const sms = await signedIn()
    await expect(sms.send('tenant-001', 'Meera')).resolves.toBeNull()
    expect(messagingService.sendMessage).not.toHaveBeenCalled()

    sms.start(BILL_REMINDER)
    await sms.send('tenant-001', 'Meera')
    sms.reset()

    expect(sms.notice.value).toBeNull()
    expect(sms.request.value).toBeNull()
    expect(sms.isOpen.value).toBe(false)
  })
})
