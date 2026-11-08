import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  devLoginEmail,
  endDevSession,
  readDevSession,
  startDevSession,
  subscribeToDevSession,
} from '@/services/devLogin'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dev login', () => {
  describe('when VITE_DEV_LOGIN_EMAIL is not set', () => {
    beforeEach(() => vi.stubEnv('VITE_DEV_LOGIN_EMAIL', ''))

    it('is off: no email, no session, and starting one fails', () => {
      expect(devLoginEmail()).toBeNull()
      expect(readDevSession()).toBeNull()
      expect(() => startDevSession()).toThrow('Dev login is off.')
    })
  })

  describe('in a production build', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_DEV_LOGIN_EMAIL', 'Dev@Example.test')
      vi.stubEnv('DEV', false)
    })

    it('is off even with the email set and a session saved', () => {
      window.localStorage.setItem('rent-tracker.dev-login-email', 'dev@example.test')

      expect(devLoginEmail()).toBeNull()
      expect(readDevSession()).toBeNull()
      expect(() => startDevSession()).toThrow()
    })
  })

  describe('when on', () => {
    beforeEach(() => vi.stubEnv('VITE_DEV_LOGIN_EMAIL', ' Dev@Example.test '))

    it('offers the configured email, trimmed and lowercased', () => {
      expect(devLoginEmail()).toBe('dev@example.test')
    })

    it('starts a session that survives a reload, and ends it', () => {
      expect(readDevSession()).toBeNull()

      expect(startDevSession()).toEqual({ id: 'dev:dev@example.test', email: 'dev@example.test' })
      expect(readDevSession()?.email).toBe('dev@example.test')

      endDevSession()
      expect(readDevSession()).toBeNull()
    })

    it('ignores a saved session for another email', () => {
      window.localStorage.setItem('rent-tracker.dev-login-email', 'someone@else.test')

      expect(readDevSession()).toBeNull()
    })

    it('tells subscribers when a session starts and ends, until they unsubscribe', () => {
      const listener = vi.fn()
      const unsubscribe = subscribeToDevSession(listener)

      startDevSession()
      endDevSession()
      unsubscribe()
      startDevSession()

      expect(listener).toHaveBeenNthCalledWith(1, {
        id: 'dev:dev@example.test',
        email: 'dev@example.test',
      })
      expect(listener).toHaveBeenNthCalledWith(2, null)
      expect(listener).toHaveBeenCalledTimes(2)
    })
  })
})
