// App-level sign-in failures. The auth service maps Firebase errors to these so nothing above
// services/ depends on Firebase error codes.
export type AuthErrorCode =
  | 'invalid-phone-number'
  | 'invalid-code'
  | 'code-expired'
  | 'session-missing'
  | 'too-many-requests'
  | 'captcha-failed'
  | 'network'
  | 'user-disabled'
  | 'not-configured'
  | 'unknown'

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
