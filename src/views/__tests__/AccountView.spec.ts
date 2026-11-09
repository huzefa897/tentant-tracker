import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { accessService } from '@/services/access.service'
import { authService } from '@/services/auth.service'
import { useAccessStore } from '@/stores/access'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import { resetTenantService } from '@/test/mocks/tenantService'
import { openPage } from '@/test/rentEntries'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))

let view: VueWrapper | undefined

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
})

afterEach(() => {
  view?.unmount()
  view = undefined
})

async function openAccount() {
  view = await openPage('/account')
  return view
}

describe('AccountView', () => {
  it('shows who is signed in and the property', async () => {
    await openAccount()

    expect(view!.get('[data-testid="account-name"]').text()).toBe('Test Owner')
    expect(view!.get('[data-testid="account-property"]').text()).toBe('Test Towers')
  })

  it('offers no property switch with a single property', async () => {
    await openAccount()

    expect(view!.find('[data-testid="account-switch-property"]').exists()).toBe(false)
  })

  it('switches property when there are several', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(
      identityWith([testProperty, { ...testProperty, id: 'annex', name: 'Annex' }]),
    )
    await openAccount()

    await view!.get('[data-testid="account-switch-property"]').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('property-select'))
  })

  it('logs out and returns to login', async () => {
    await openAccount()

    await view!.get('[data-testid="account-logout"]').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('login'))
    expect(authService.logout).toHaveBeenCalled()
    expect(useAccessStore().selectedPropertyId).toBeNull()
  })
})
