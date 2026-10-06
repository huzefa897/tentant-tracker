import { vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import type { Tenant, TenantPage } from '@/types/tenant'

// A fake tenantService that searches and pages like the API. Use it with
//   vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
// and call resetTenantService() in beforeEach. Fictional people; the ids are fixtures, not
// backend UUIDs.

export const testTenants: Tenant[] = [
  {
    id: 'tenant-001',
    name: 'Shaik Zahid Ali',
    flatNumber: '202',
    rentAmount: 15000,
    rentDueDay: 11,
    electricityRate: 6,
    mobileNumber: '+918341413827',
    depositAmount: 90000,
    startDate: '2025-04-01',
    endDate: null,
  },
  {
    id: 'tenant-002',
    name: 'Mohammed Yusuf',
    flatNumber: '301',
    rentAmount: 18000,
    rentDueDay: 10,
    electricityRate: 6,
    mobileNumber: '+919876543210',
    depositAmount: 100000,
    startDate: '2026-02-15',
    endDate: null,
  },
  {
    id: 'tenant-003',
    name: 'Ali Hussain',
    flatNumber: '102',
    rentAmount: 14000,
    rentDueDay: 5,
    electricityRate: 6,
    mobileNumber: '+919123456789',
    depositAmount: 80000,
    startDate: '2024-06-01',
    endDate: null,
  },
]

// Who the fake knows about and how many it returns per page; tests may change both.
export const fakeTenancies = { tenants: [...testTenants], pageSize: 20 }

export function pageOf(
  tenants: Tenant[],
  options: { search?: string; page?: number } = {},
  pageSize = fakeTenancies.pageSize,
): TenantPage {
  const query = options.search?.trim().toLowerCase() ?? ''
  const matches = tenants.filter(
    (t) =>
      !query || t.name.toLowerCase().includes(query) || t.flatNumber.toLowerCase().includes(query),
  )
  const page = options.page ?? 1
  const start = (page - 1) * pageSize

  return {
    tenants: matches.slice(start, start + pageSize),
    count: matches.length,
    page,
    hasMore: start + pageSize < matches.length,
  }
}

export const tenantService = {
  getTenants: vi.fn(),
  getTenant: vi.fn(),
}

export function resetTenantService() {
  fakeTenancies.tenants = [...testTenants]
  fakeTenancies.pageSize = 20
  tenantService.getTenants
    .mockReset()
    .mockImplementation(async (_propertyId: string, options?: { search?: string; page?: number }) =>
      pageOf(fakeTenancies.tenants, options),
    )
  tenantService.getTenant
    .mockReset()
    .mockImplementation(async (_propertyId: string, id: string) => {
      const tenant = fakeTenancies.tenants.find((t) => t.id === id)
      if (!tenant) throw new ApiError('not-found', 'Not found')
      return tenant
    })
}

resetTenantService()
