// App-level API failures, so callers never handle Axios errors.
export type ApiErrorKind =
  | 'unauthorized' // 401: token missing, invalid or rejected (e.g. inactive user)
  | 'forbidden'
  | 'not-found'
  | 'unavailable' // 503 (e.g. Firebase verification down) or another 5xx
  | 'network' // no response: offline, server down, CORS
  | 'invalid-response' // a response that doesn't match the contract
  | 'unknown'

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string = kind,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
