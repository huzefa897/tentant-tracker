// App-level sign-in failures. The auth service maps Firebase errors to these so nothing above
// services/ depends on Firebase error codes.
export type AuthErrorCode =
  // The person closed Google's popup: not a failure to report.
  | 'cancelled'
  | 'popup-blocked'
  // The email already signed in to this Firebase project another way (e.g. a password).
  | 'account-exists'
  | 'too-many-requests'
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
