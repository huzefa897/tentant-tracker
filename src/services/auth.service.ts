import type { AuthUser, SendOtpRequest, VerifyOtpRequest } from '@/types/auth'

// Mock implementation. Swapped for Firebase later; callers should not change.
const MOCK_OTP = '924636'
const MOCK_DELAY_MS = 500

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const authService = {
  async sendOtp(_payload: SendOtpRequest): Promise<void> {
    await delay(MOCK_DELAY_MS)
  },

  async verifyOtp(payload: VerifyOtpRequest): Promise<AuthUser> {
    await delay(MOCK_DELAY_MS)

    if (payload.code !== MOCK_OTP) {
      throw new Error('Invalid verification code')
    }

    return {
      id: 'mock-user-1',
      phoneNumber: payload.phoneNumber,
    }
  },

  async logout(): Promise<void> {
    await Promise.resolve()
  },
}
