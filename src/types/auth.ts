// The signed-in Firebase identity. `id` is the Firebase UID and `email` the Google account's;
// the backend's user id and property access come from /api/v1/me/ (types/access.ts).
export interface AuthUser {
  id: string
  email: string
}
