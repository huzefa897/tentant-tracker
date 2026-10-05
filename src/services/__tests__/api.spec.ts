import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, toApiError } from '@/services/api'
import { ApiError } from '@/services/apiError'
import { authService } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'
import { resetAuthService } from '@/test/mocks/authService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))

function axiosError(status?: number, data: unknown = {}) {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  const response =
    status === undefined ? undefined : { status, statusText: '', headers: {}, config, data }
  return new AxiosError('request failed', undefined, config, undefined, response)
}

// Runs a request through the real interceptors without sending it.
async function sentHeaders() {
  let headers: AxiosHeaders | undefined
  await api.get('/me/', {
    adapter: async (config) => {
      headers = config.headers
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    },
  })
  return headers!
}

beforeEach(() => {
  resetAuthService()
})

describe('api client', () => {
  it('calls /api/v1 on the same origin by default', () => {
    expect(api.defaults.baseURL).toBe('/api/v1')
  })

  it('sends the Firebase ID token as a Bearer token', async () => {
    expect((await sentHeaders()).get('Authorization')).toBe('Bearer test-id-token')
  })

  it('sends no Authorization header when signed out', async () => {
    vi.mocked(authService.getIdToken).mockResolvedValue(null)

    expect((await sentHeaders()).has('Authorization')).toBe(false)
  })
})

describe('toApiError', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [503, 'unavailable'],
    [500, 'unavailable'],
    [400, 'unknown'],
  ])('maps HTTP %i to %s', (status, kind) => {
    expect(toApiError(axiosError(status)).kind).toBe(kind)
  })

  it('keeps the backend’s reason code', () => {
    const error = toApiError(axiosError(403, { detail: 'Not registered', code: 'not_registered' }))

    expect(error).toMatchObject({ kind: 'forbidden', code: 'not_registered' })
  })

  it('has no code when the backend gives none', () => {
    expect(toApiError(axiosError(403, { detail: 'No' })).code).toBeNull()
    expect(toApiError(axiosError(500, 'Server Error')).code).toBeNull()
  })

  it('treats no response as a network failure', () => {
    expect(toApiError(axiosError()).kind).toBe('network')
  })

  it('treats a token refresh that failed offline as a network failure', () => {
    expect(toApiError(new AuthError('network')).kind).toBe('network')
  })

  it('passes API errors through and wraps anything else', () => {
    const error = new ApiError('forbidden')

    expect(toApiError(error)).toBe(error)
    expect(toApiError(new Error('boom'))).toMatchObject({ kind: 'unknown', message: 'boom' })
  })
})
