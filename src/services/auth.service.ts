import type { AuthUser, SendOtpRequest, VerifyOtpRequest } from '@/types/auth'
import { isValidPhoneNumber, isValidOtpCode } from '@/utils/authValidation'

// Development-only mock: a hard-coded OTP is not authentication. Replaced by Firebase phone
// auth later, which also changes session restore and the OTP flow (see CLAUDE.md).
const MOCK_OTP = '924636'
const MOCK_DELAY_MS = 500

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The service owns the request contract, so a backend swap keeps the same checks.
function assertValidPhoneNumber(phoneNumber: string) {
  if (!isValidPhoneNumber(phoneNumber)) {
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
