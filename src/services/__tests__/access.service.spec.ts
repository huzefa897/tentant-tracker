import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService, parseAppIdentity } from '@/services/access.service'
import { api } from '@/services/api'
import { ApiError } from '@/services/apiError'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

const me = {
  id: 7,
  phoneNumber: '+918341413827',
  properties: [{ id: 'property-1', name: 'Test Towers', role: 'owner' }],
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('parseAppIdentity', () => {
  it('reads a valid /me response', () => {
    expect(parseAppIdentity(me)).toEqual(me)
  })

  it('accepts a user without properties', () => {
    expect(parseAppIdentity({ ...me, properties: [] }).properties).toEqual([])
  })

  it.each([
    ['not an object', null],
    ['a missing properties list', { id: 7, phoneNumber: '' }],
    ['a string id', { ...me, id: '7' }],
    ['an unknown role', { ...me, properties: [{ id: 'p', name: 'P', role: 'tenant' }] }],
    ['a property without a name', { ...me, properties: [{ id: 'p', role: 'owner' }] }],
  ])('rejects %s instead of treating it as no access', (_label, data) => {
    expect(() => parseAppIdentity(data)).toThrow(ApiError)
  })
})

describe('accessService.getMe', () => {
  it('fetches /me/ and returns the parsed identity', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: me })

    await expect(accessService.getMe()).resolves.toEqual(me)
    expect(get).toHaveBeenCalledWith('/me/')
  })

  it('turns request failures into API errors', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'))

    await expect(accessService.getMe()).rejects.toMatchObject({ kind: 'unknown' })
  })

  it('rejects a malformed response', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { properties: 'none' } })

    await expect(accessService.getMe()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
})
