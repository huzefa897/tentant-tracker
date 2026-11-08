import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'

import { authService, toAuthError } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'

const fakeAuth = {
  currentUser: null as null | { getIdToken: () => Promise<string> },
  authStateReady: vi.fn(async () => {}),
}

vi.mock('@/services/firebase', () => ({ getFirebaseAuth: () => fakeAuth }))

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(function (this: { setCustomParameters: () => void }) {
    this.setCustomParameters = vi.fn()
  }),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}))

const email = 'owner@example.com'
const firebaseUser = { uid: 'firebase-uid-1', email }

function firebaseError(code: string) {
  return Object.assign(new Error(code), { code })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  fakeAuth.currentUser = null
})

describe('authService', () => {
  describe('onAuthStateChanged', () => {
    it('reports Firebase users as app users and null when signed out', () => {
      const listener = vi.fn()
      authService.onAuthStateChanged(listener)
      const firebaseListener = vi.mocked(onAuthStateChanged).mock.calls[0]![1] as (
        user: unknown,
      ) => void

      firebaseListener(firebaseUser)
      firebaseListener({ uid: 'no-email', email: null })
      firebaseListener(null)

      expect(listener).toHaveBeenNthCalledWith(1, { id: 'firebase-uid-1', email })
      expect(listener).toHaveBeenNthCalledWith(2, { id: 'no-email', email: '' })
      expect(listener).toHaveBeenNthCalledWith(3, null)
    })
  })

  describe('signInWithGoogle', () => {
    it("opens Google's account chooser and returns the app user", async () => {
      vi.mocked(signInWithPopup).mockResolvedValue({ user: firebaseUser } as never)

      await expect(authService.signInWithGoogle()).resolves.toEqual({
        id: 'firebase-uid-1',
        email,
      })

      const provider = vi.mocked(GoogleAuthProvider).mock.instances[0] as unknown as {
        setCustomParameters: ReturnType<typeof vi.fn>
      }
      expect(signInWithPopup).toHaveBeenCalledWith(fakeAuth, provider)
      // Always asks which account, so a shared device doesn't sign in the wrong person.
      expect(provider.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' })
    })

    it('maps the error when Firebase refuses', async () => {
      vi.mocked(signInWithPopup).mockRejectedValue(firebaseError('auth/popup-blocked'))

      await expect(authService.signInWithGoogle()).rejects.toMatchObject({
        code: 'popup-blocked',
      })
    })
  })

  describe('getIdToken', () => {
    it('waits for the restored session and returns the current token', async () => {
      fakeAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('id-token') }

      await expect(authService.getIdToken()).resolves.toBe('id-token')
      expect(fakeAuth.authStateReady).toHaveBeenCalled()
    })

    it('returns null when signed out', async () => {
      await expect(authService.getIdToken()).resolves.toBeNull()
    })
  })

  it('logout signs out of Firebase', async () => {
    vi.mocked(signOut).mockResolvedValue()

    await authService.logout()

    expect(signOut).toHaveBeenCalledWith(fakeAuth)
  })
})

describe('getAuthorization', () => {
  it('is a Bearer token, or null when signed out', async () => {
    fakeAuth.currentUser = { getIdToken: async () => 'abc' }
    await expect(authService.getAuthorization()).resolves.toBe('Bearer abc')

    fakeAuth.currentUser = null
    await expect(authService.getAuthorization()).resolves.toBeNull()
  })
})

describe('dev login', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubEnv('VITE_DEV_LOGIN_EMAIL', 'dev@example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('signs in without Firebase, sends a Dev authorization and signs out without Firebase', async () => {
    const listener = vi.fn()
    authService.onAuthStateChanged(listener)

    const user = authService.signInAsDev()

    expect(user.email).toBe('dev@example.test')
    expect(listener).toHaveBeenLastCalledWith(user)
    await expect(authService.getAuthorization()).resolves.toBe('Dev dev@example.test')

    await authService.logout()

    expect(listener).toHaveBeenLastCalledWith(null)
    expect(signOut).not.toHaveBeenCalled()
    await expect(authService.getAuthorization()).resolves.toBeNull()
  })

  it('restores a saved dev session, ignoring Firebase while it lasts', () => {
    authService.signInAsDev()
    const listener = vi.fn()

    authService.onAuthStateChanged(listener)
    const firebaseListener = vi.mocked(onAuthStateChanged).mock.calls[0]![1] as (
      user: unknown,
    ) => void
    firebaseListener(null)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ id: 'dev:dev@example.test', email: 'dev@example.test' })
  })

  it('follows Firebase again after a dev logout, so a later Google session is tracked', async () => {
    authService.signInAsDev()
    const listener = vi.fn()
    authService.onAuthStateChanged(listener)
    const firebaseListener = vi.mocked(onAuthStateChanged).mock.calls[0]![1] as (
      user: unknown,
    ) => void

    await authService.logout()
    firebaseListener(firebaseUser)
    firebaseListener(null)

    expect(listener).toHaveBeenNthCalledWith(3, { id: 'firebase-uid-1', email })
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('reaches the login page with no Firebase config', () => {
    vi.mocked(onAuthStateChanged).mockImplementation(() => {
      throw new AuthError('not-configured')
    })
    const listener = vi.fn()

    authService.onAuthStateChanged(listener)

    expect(listener).toHaveBeenCalledWith(null)
  })

  it('is off in a production build', () => {
    vi.stubEnv('DEV', false)

    expect(authService.devLoginEmail()).toBeNull()
    expect(() => authService.signInAsDev()).toThrow()
  })
})

describe('toAuthError', () => {
  it.each([
    ['auth/popup-closed-by-user', 'cancelled'],
    ['auth/cancelled-popup-request', 'cancelled'],
    ['auth/popup-blocked', 'popup-blocked'],
    ['auth/account-exists-with-different-credential', 'account-exists'],
    ['auth/too-many-requests', 'too-many-requests'],
    ['auth/network-request-failed', 'network'],
    ['auth/user-disabled', 'user-disabled'],
    ['auth/operation-not-allowed', 'not-configured'],
    ['auth/unauthorized-domain', 'not-configured'],
    ['auth/something-new', 'unknown'],
  ])('maps %s to %s', (firebaseCode, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(toAuthError(firebaseError(firebaseCode)).code).toBe(code)
  })

  it('logs the Firebase code for setup and unexpected errors, which users see only generally', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    toAuthError(firebaseError('auth/operation-not-allowed'))
    toAuthError(firebaseError('auth/popup-closed-by-user'))

    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      'Firebase sign-in failed (auth/operation-not-allowed): auth/operation-not-allowed',
    )
  })

  it('passes app errors through and wraps anything else', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new AuthError('network')

    expect(toAuthError(error)).toBe(error)
    expect(toAuthError('boom')).toMatchObject({ code: 'unknown', message: 'boom' })
  })
})
