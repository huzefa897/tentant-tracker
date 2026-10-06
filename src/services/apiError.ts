// App-level API failures, so callers never handle Axios errors.
export type ApiErrorKind =
  | 'unauthorized' // 401: token missing, invalid or rejected (e.g. inactive user)
  | 'forbidden'
  | 'not-found'
  | 'invalid-request' // 400: the backend rejected what was sent (see fieldErrors)
  | 'conflict' // 409: e.g. a bill already exists for that month
  | 'unavailable' // 503 (e.g. Firebase verification down) or another 5xx
  | 'network' // no response: offline, server down, CORS
  | 'invalid-response' // a response that doesn't match the contract
  | 'unknown'

export class ApiError extends Error {
  // code: the backend's machine-readable reason, when it gives one (e.g. 'not_registered').
  // fieldErrors: a 400's first message per field, keyed as the backend names them.
  constructor(
    readonly kind: ApiErrorKind,
    message: string = kind,
    readonly code: string | null = null,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
