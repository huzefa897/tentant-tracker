import axios, { isAxiosError } from 'axios'

import { ApiError } from '@/services/apiError'
import { authService } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'

// Same-origin /api/v1 by default: the Vite dev server proxies /api to Django (vite.config.ts).
// Set VITE_API_BASE_URL to call another origin (that origin must allow it through CORS).
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 15_000,
})

api.interceptors.request.use(async (config) => {
  const token = await authService.getIdToken()

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

// DRF validation errors: {"field": ["message", ...]}. Keeps the first message of each field.
// A nested object's fields are named with a dot, e.g. "initialPayment.paidDate".
function fieldErrorsOf(data: unknown, prefix = ''): Record<string, string> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}

  const errors: Record<string, string> = {}
  for (const [field, messages] of Object.entries(data)) {
    const first: unknown = Array.isArray(messages) ? messages[0] : messages
    if (typeof first === 'string') errors[`${prefix}${field}`] = first
    else if (!prefix) Object.assign(errors, fieldErrorsOf(messages, `${field}.`))
  }
  return errors
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof AuthError && error.code === 'network') {
    return new ApiError('network', error.message)
  }
  if (!isAxiosError(error)) {
    return new ApiError('unknown', error instanceof Error ? error.message : String(error))
  }

  const status = error.response?.status
  const data: unknown = error.response?.data
  const code =
    typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string'
      ? data.code
      : null

  if (status === undefined) return new ApiError('network', error.message)
  if (status === 400)
    return new ApiError('invalid-request', error.message, code, fieldErrorsOf(data))
  if (status === 401) return new ApiError('unauthorized', error.message, code)
  if (status === 403) return new ApiError('forbidden', error.message, code)
  if (status === 404) return new ApiError('not-found', error.message, code)
  if (status === 409) {
    const details = typeof data === 'object' && data !== null && !Array.isArray(data) ? data : {}
    return new ApiError('conflict', error.message, code, {}, details as Record<string, unknown>)
  }
  if (status >= 500) return new ApiError('unavailable', error.message, code)
  return new ApiError('unknown', error.message, code)
}
