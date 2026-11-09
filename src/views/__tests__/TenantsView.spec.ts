import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { tenantService } from '@/services/tenant.service'
import { resetAccessService, testProperty } from '@/test/mocks/accessService'
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
  vi.useRealTimers()
})

describe('TenantsView', () => {
  it('lists the property’s current tenants', async () => {
    view = await openPage('/tenants')

    expect(view.get('h1').text()).toBe('Tenants')
    expect(view.get('[data-testid="selected-property"]').text()).toBe('Test Towers')
    expect(tenantService.getTenants).toHaveBeenCalledWith(testProperty.id, { search: '' })
    expect(view.findAll('[data-testid="tenant-list"] li')).toHaveLength(3)
  })

  it('opens a tenant’s page', async () => {
    view = await openPage('/tenants')

    await view.get('[data-testid="tenant-tenant-002"]').trigger('click')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('tenant'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-002')
  })

  it('auto-retries a failed load, showing the error meanwhile', async () => {
    vi.useFakeTimers()
    vi.mocked(tenantService.getTenants).mockRejectedValueOnce(new Error('boom'))
    view = await openPage('/tenants')

    expect(view.find('[data-testid="tenant-list"]').exists()).toBe(false)
    expect(view.get('[role="alert"]').text()).toContain('Unable to load tenants.')

    vi.advanceTimersByTime(5000)
    await flushPromises()

    expect(view.findAll('[data-testid="tenant-list"] li')).toHaveLength(3)
  })

  it('lights up Tenants in the nav', async () => {
    view = await openPage('/tenants')

    expect(view.get('[data-testid="app-nav-bar"] [aria-current="page"]').text()).toBe('Tenants')
  })
})
