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

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof AuthError && error.code === 'network') {
    return new ApiError('network', error.message)
  }
  if (!isAxiosError(error)) {
    return new ApiError('unknown', error instanceof Error ? error.message : String(error))
  }

  const status = error.response?.status
  if (status === undefined) return new ApiError('network', error.message)
  if (status === 401) return new ApiError('unauthorized', error.message)
  if (status === 403) return new ApiError('forbidden', error.message)
  if (status === 404) return new ApiError('not-found', error.message)
  if (status >= 500) return new ApiError('unavailable', error.message)
  return new ApiError('unknown', error.message)
}
