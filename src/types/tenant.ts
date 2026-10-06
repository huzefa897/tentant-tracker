// Frontend domain model: one tenancy (an occupant of a flat) from the backend, mapped by
// services/tenant.service.ts. `id` is the backend tenancy id.
export interface Tenant {
  id: string
  name: string
  flatNumber: string
  rentAmount: number
  // Day of the month rent is due (1-28)
  rentDueDay: number
  // Rupees per unit of electricity
  electricityRate: number
  // E.164, e.g. "+918341413827"
  mobileNumber: string
  depositAmount: number
  // The occupancy (YYYY-MM-DD, end inclusive; null while it continues). Bills can only be for
  // months it overlaps.
  startDate: string
  endDate: string | null
}

// One page of tenant search results.
export interface TenantPage {
  tenants: Tenant[]
  // Matches across all pages.
  count: number
  page: number
  hasMore: boolean
}
