export interface AuthUser {
  id: string
  phoneNumber: string
}

export interface SendOtpRequest {
  phoneNumber: string
}

export interface VerifyOtpRequest {
  phoneNumber: string
  code: string
}
