import type { AuthUser, SendOtpRequest, VerifyOtpRequest } from '@/types/auth'
import { isValidIndianPhoneNumber, isValidOtpCode } from '@/utils/authValidation'

// Mock implementation. Swapped for Firebase later; callers should not change.
const MOCK_OTP = '924636'
const MOCK_DELAY_MS = 500

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The service owns the request contract, so a backend swap keeps the same checks.
function assertValidPhoneNumber(phoneNumber: string) {
  if (!isValidIndianPhoneNumber(phoneNumber)) {
    throw new Error('Invalid phone number')
  }
}

export const authService = {
  async sendOtp(payload: SendOtpRequest): Promise<void> {
    assertValidPhoneNumber(payload.phoneNumber)

    await delay(MOCK_DELAY_MS)
  },

  async verifyOtp(payload: VerifyOtpRequest): Promise<AuthUser> {
    assertValidPhoneNumber(payload.phoneNumber)

    if (!isValidOtpCode(payload.code)) {
      throw new Error('Invalid verification code')
    }

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
