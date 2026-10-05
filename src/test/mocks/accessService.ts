import { vi } from 'vitest'

import type { AppIdentity, PropertyAccess } from '@/types/access'

// A fake accessService. Use it with
//   vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
// and call resetAccessService() in beforeEach. By default the user has one property, which
// the access store selects automatically, so protected pages open directly.

export const testProperty: PropertyAccess = {
  id: '6f1c2a4e-0000-4000-8000-000000000001',
  name: 'Test Towers',
  role: 'owner',
}

export function identityWith(properties: PropertyAccess[]): AppIdentity {
  return { id: 1, phoneNumber: '+918341413827', properties }
}

export const accessService = {
  getMe: vi.fn(),
}

export function resetAccessService() {
  accessService.getMe.mockReset().mockResolvedValue(identityWith([testProperty]))
}

resetAccessService()
