import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authService } from '@/services/auth.service'

const phoneNumber = '+918341413827'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('authService.sendOtp', () => {
  it.each([phoneNumber, '+61412345678', '+12015550123'])(
    'resolves for a valid number in a supported country (%s)',
    async (value) => {
      const result = authService.sendOtp({ phoneNumber: value })
      await vi.runAllTimersAsync()

      await expect(result).resolves.toBeUndefined()
    },
  )

  it.each(['8341413827', '+447911123456'])('rejects %s', async (value) => {
    await expect(authService.sendOtp({ phoneNumber: value })).rejects.toThrow(
      'Invalid phone number',
    )
  })
})

describe('authService.verifyOtp', () => {
  it('returns the user for the mock code', async () => {
    const result = authService.verifyOtp({ phoneNumber, code: '924636' })
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({ id: 'mock-user-1', phoneNumber })
  })

  it('rejects a wrong code', async () => {
    // Capture the rejection before advancing timers so it isn't reported as unhandled.
    const result = authService.verifyOtp({ phoneNumber, code: '111111' }).catch((err) => err)
    await vi.runAllTimersAsync()

    expect(await result).toEqual(new Error('Invalid verification code'))
  })

  it('rejects a malformed code before calling the backend', async () => {
    await expect(authService.verifyOtp({ phoneNumber, code: '9246' })).rejects.toThrow(
      'Invalid verification code',
    )
  })

  it('rejects an invalid number', async () => {
    await expect(authService.verifyOtp({ phoneNumber: '+91123', code: '924636' })).rejects.toThrow(
      'Invalid phone number',
    )
  })
})
