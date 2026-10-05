// The signed-in Firebase identity. `id` is the Firebase UID; the backend's user id and
// property access come from /api/v1/me/ (types/access.ts).
export interface AuthUser {
  id: string
  phoneNumber: string
}

export interface SendOtpRequest {
  phoneNumber: string
}

export interface VerifyOtpRequest {
  code: string
}
