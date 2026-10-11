export type PropertyRole = 'owner' | 'manager'

// A property the signed-in user may access, with their role there.
export interface PropertyAccess {
  id: string
  name: string
  role: PropertyRole
}

// The backend's view of the signed-in user (GET /api/v1/me/). No properties means signed in
// but access not configured yet.
export interface AppIdentity {
  id: number
  // The person's name as set in admin; empty when nobody has set it.
  name: string
  phoneNumber: string
  properties: PropertyAccess[]
}
