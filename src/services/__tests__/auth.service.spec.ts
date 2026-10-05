import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth'

import { authService, toAuthError } from '@/services/auth.service'
import { AuthError } from '@/services/authErrors'

const fakeAuth = {
  currentUser: null as null | { getIdToken: () => Promise<string> },
  authStateReady: vi.fn(async () => {}),
}

vi.mock('@/services/firebase', () => ({ getFirebaseAuth: () => fakeAuth }))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
  RecaptchaVerifier: vi.fn(function (
    this: { clear: () => void; parentAtCreation: Node | null },
    _auth: unknown,
    container: HTMLElement,
  ) {
    this.clear = vi.fn()
    this.parentAtCreation = container.parentNode
  }),
  signInWithPhoneNumber: vi.fn(),
  signOut: vi.fn(),
}))

const phoneNumber = '+918341413827'
const firebaseUser = { uid: 'firebase-uid-1', phoneNumber }

function firebaseError(code: string) {
  return Object.assign(new Error(code), { code })
}

function confirmationResult(confirm = vi.fn().mockResolvedValue({ user: firebaseUser })) {
  return { confirm } as unknown as ConfirmationResult
}

async function startFlow(confirmation = confirmationResult()) {
  vi.mocked(signInWithPhoneNumber).mockResolvedValue(confirmation)
  await authService.sendOtp({ phoneNumber }, document.createElement('div'))
  return confirmation
}

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  fakeAuth.currentUser = null
  // Forget any pending confirmation from an earlier test.
  vi.mocked(signOut).mockResolvedValue()
  await authService.logout()
  vi.clearAllMocks()
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
      firebaseListener(null)

      expect(listener).toHaveBeenNthCalledWith(1, { id: 'firebase-uid-1', phoneNumber })
      expect(listener).toHaveBeenNthCalledWith(2, null)
    })
  })

  describe('sendOtp', () => {
    it('rejects an invalid number without calling Firebase', async () => {
      await expect(
        authService.sendOtp({ phoneNumber: '12345' }, document.createElement('div')),
      ).rejects.toMatchObject({ code: 'invalid-phone-number' })
      expect(signInWithPhoneNumber).not.toHaveBeenCalled()
    })

    it('runs an invisible reCAPTCHA inside the host and removes it afterwards', async () => {
      const host = document.createElement('div')
      vi.mocked(signInWithPhoneNumber).mockResolvedValue(confirmationResult())

      await authService.sendOtp({ phoneNumber }, host)

      const [, , options] = vi.mocked(RecaptchaVerifier).mock.calls[0]!
      const verifier = vi.mocked(RecaptchaVerifier).mock.instances[0] as unknown as {
        clear: ReturnType<typeof vi.fn>
        parentAtCreation: Node | null
      }
      expect(verifier.parentAtCreation).toBe(host)
      expect(options).toEqual({ size: 'invisible' })
      expect(signInWithPhoneNumber).toHaveBeenCalledWith(fakeAuth, phoneNumber, verifier)
      expect(verifier.clear).toHaveBeenCalled()
      expect(host.children).toHaveLength(0)
    })

    it('cleans up and maps the error when Firebase refuses', async () => {
      const host = document.createElement('div')
      vi.mocked(signInWithPhoneNumber).mockRejectedValue(firebaseError('auth/too-many-requests'))

      await expect(authService.sendOtp({ phoneNumber }, host)).rejects.toMatchObject({
        code: 'too-many-requests',
      })
      expect(host.children).toHaveLength(0)
    })
  })

  describe('verifyOtp', () => {
    it('rejects a malformed code without calling Firebase', async () => {
      const confirmation = await startFlow()

      await expect(authService.verifyOtp({ code: '12' })).rejects.toMatchObject({
        code: 'invalid-code',
      })
      expect(confirmation.confirm).not.toHaveBeenCalled()
    })

    it('needs a code to have been sent first', async () => {
      await expect(authService.verifyOtp({ code: '123456' })).rejects.toMatchObject({
        code: 'session-missing',
      })
    })

    it('confirms the code and returns the app user', async () => {
      const confirmation = await startFlow()

      await expect(authService.verifyOtp({ code: '123456' })).resolves.toEqual({
        id: 'firebase-uid-1',
        phoneNumber,
      })
      expect(confirmation.confirm).toHaveBeenCalledWith('123456')
    })

    it('can only use a confirmation once', async () => {
      await startFlow()
      await authService.verifyOtp({ code: '123456' })

      await expect(authService.verifyOtp({ code: '123456' })).rejects.toMatchObject({
        code: 'session-missing',
      })
    })

    it('keeps the confirmation after a wrong code so the user can retry', async () => {
      const confirm = vi
        .fn()
        .mockRejectedValueOnce(firebaseError('auth/invalid-verification-code'))
        .mockResolvedValue({ user: firebaseUser })
      await startFlow(confirmationResult(confirm))

      await expect(authService.verifyOtp({ code: '111111' })).rejects.toMatchObject({
        code: 'invalid-code',
      })
      await expect(authService.verifyOtp({ code: '123456' })).resolves.toMatchObject({
        id: 'firebase-uid-1',
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

  it('logout signs out and drops a pending confirmation', async () => {
    await startFlow()

    await authService.logout()

    expect(signOut).toHaveBeenCalledWith(fakeAuth)
    await expect(authService.verifyOtp({ code: '123456' })).rejects.toMatchObject({
      code: 'session-missing',
    })
  })
})

describe('toAuthError', () => {
  it.each([
    ['auth/invalid-verification-code', 'invalid-code'],
    ['auth/code-expired', 'code-expired'],
    ['auth/quota-exceeded', 'too-many-requests'],
    ['auth/captcha-check-failed', 'captcha-failed'],
    ['auth/network-request-failed', 'network'],
    ['auth/user-disabled', 'user-disabled'],
    ['auth/operation-not-allowed', 'not-configured'],
    ['auth/billing-not-enabled', 'not-configured'],
    ['auth/something-new', 'unknown'],
  ])('maps %s to %s', (firebaseCode, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(toAuthError(firebaseError(firebaseCode)).code).toBe(code)
  })

  it('logs the Firebase code for setup and unexpected errors, which users see only generally', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    toAuthError(firebaseError('auth/operation-not-allowed'))
    toAuthError(firebaseError('auth/invalid-verification-code'))

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
