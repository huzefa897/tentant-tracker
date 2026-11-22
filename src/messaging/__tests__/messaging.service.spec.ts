import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'
import { messagingService } from '@/messaging/messaging.service'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const PROPERTY_ID = '6f1c2a4e-0000-4000-8000-000000000001'
const TENANCY_ID = '0b9d7a1e-0000-4000-8000-000000000101'
const ENTRY_ID = '5d0c9b2a-0000-4000-8000-000000000201'
const MESSAGES_URL = `/properties/${PROPERTY_ID}/tenancies/${TENANCY_ID}/messages/`
const BILL_REMINDER = { kind: 'bill_reminder', entryId: ENTRY_ID } as const

function httpError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError('failed', undefined, config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('messagingService.getPropertyMessaging', () => {
  it("reads the property's messaging", async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: { enabled: true, ready: false, canSend: true },
    })

    await expect(messagingService.getPropertyMessaging(PROPERTY_ID)).resolves.toEqual({
      enabled: true,
      ready: false,
      canSend: true,
    })
    expect(get).toHaveBeenCalledWith(`/properties/${PROPERTY_ID}/messaging/`)
  })

  it.each([null, [], { enabled: 'yes', ready: true, canSend: true }, { enabled: true }])(
    'refuses an unexpected answer (%j)',
    async (data) => {
      vi.spyOn(api, 'get').mockResolvedValue({ data })
      await expect(messagingService.getPropertyMessaging(PROPERTY_ID)).rejects.toMatchObject({
        kind: 'invalid-response',
      })
    },
  )

  it('throws an ApiError when the request fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(httpError(404, { detail: 'Not found.' }))
    const error = await messagingService.getPropertyMessaging(PROPERTY_ID).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('not-found')
  })
})

describe('messagingService.sendMessage', () => {
  it("posts the message's kind and subject to the tenancy's messages, returning the outcome", async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      status: 201,
      data: { status: 'failed', reason: 'The provider refused it.', sentAt: null },
    })

    await expect(
      messagingService.sendMessage(PROPERTY_ID, TENANCY_ID, BILL_REMINDER),
    ).resolves.toEqual({ outcome: 'failed', reason: 'The provider refused it.' })
    expect(post).toHaveBeenCalledWith(MESSAGES_URL, BILL_REMINDER)
  })

  it.each([{ status: 'queued', reason: '' }, { status: 'sent' }, 'sent'])(
    'refuses an unexpected answer (%j)',
    async (data) => {
      vi.spyOn(api, 'post').mockResolvedValue({ status: 201, data })
      await expect(
        messagingService.sendMessage(PROPERTY_ID, TENANCY_ID, BILL_REMINDER),
      ).rejects.toMatchObject({ kind: 'invalid-response' })
    },
  )

  it("passes on the backend's reason for sending nothing", async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      httpError(409, { code: 'already_sent_today', detail: 'Already sent today.' }),
    )
    await expect(
      messagingService.sendMessage(PROPERTY_ID, TENANCY_ID, BILL_REMINDER),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'already_sent_today' })
  })
})

describe('messagingService.previewMessage', () => {
  const DUES = { kind: 'dues_reminder' } as const

  it('reads what a dues reminder would say, money as numbers', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        body: 'Hi Meera, ...',
        months: [
          { month: '2026-08', dueDate: '2026-08-11', outstanding: null },
          { month: '2026-09', dueDate: '2026-09-11', outstanding: '4712.50' },
        ],
        billedOutstanding: '4712.50',
      },
    })

    await expect(messagingService.previewMessage(PROPERTY_ID, TENANCY_ID, DUES)).resolves.toEqual({
      body: 'Hi Meera, ...',
      months: [
        { month: '2026-08', dueDate: '2026-08-11', outstanding: null },
        { month: '2026-09', dueDate: '2026-09-11', outstanding: 4712.5 },
      ],
      billedOutstanding: 4712.5,
    })
    expect(get).toHaveBeenCalledWith(`${MESSAGES_URL}preview/`, { params: DUES })
  })

  it.each([
    null,
    { body: 'x', months: 'none', billedOutstanding: '0.00' },
    {
      body: 'x',
      months: [{ month: 'Aug', dueDate: '2026-08-11', outstanding: null }],
      billedOutstanding: '0.00',
    },
    { body: 'x', months: [], billedOutstanding: 'lots' },
    {
      body: 'x',
      months: [{ month: '2026-08', dueDate: '2026-08-11', outstanding: 12 }],
      billedOutstanding: '0.00',
    },
  ])('refuses an unexpected answer (%j)', async (data) => {
    vi.spyOn(api, 'get').mockResolvedValue({ data })
    await expect(
      messagingService.previewMessage(PROPERTY_ID, TENANCY_ID, DUES),
    ).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it("passes on the backend's reason there's nothing to send", async () => {
    vi.spyOn(api, 'get').mockRejectedValue(
      httpError(409, { code: 'nothing_owed', detail: 'Nothing is owed.' }),
    )
    await expect(
      messagingService.previewMessage(PROPERTY_ID, TENANCY_ID, DUES),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'nothing_owed' })
  })
})
