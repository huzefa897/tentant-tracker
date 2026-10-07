import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { tenantService } from '@/services/tenant.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { TENANTS_LOAD_ERROR_MESSAGE, useTenantStore } from '@/stores/tenant'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeTenancies, pageOf, resetTenantService, testTenants } from '@/test/mocks/tenantService'
import type { TenantPage } from '@/types/tenant'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))

const annex = { id: '6f1c2a4e-0000-4000-8000-000000000002', name: 'Annex', role: 'owner' as const }

const getTenants = vi.mocked(tenantService.getTenants)
const getTenant = vi.mocked(tenantService.getTenant)

// A request the test answers itself, to control the order responses arrive in.
function deferred() {
  let resolve!: (page: TenantPage) => void
  const promise = new Promise<TenantPage>((r) => (resolve = r))
  return { promise, resolve }
}

// Signed in, with the test property selected (one property: selected automatically).
async function withProperty(properties = [testProperty]) {
  vi.mocked(accessService.getMe).mockResolvedValue(identityWith(properties))
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
  if (properties.length > 1) useAccessStore().selectProperty(properties[0]!.id)
  return useTenantStore()
}

function names(store: ReturnType<typeof useTenantStore>) {
  return store.results.map((tenant) => tenant.name)
}

beforeEach(() => {
  resetAuthService()
  resetAccessService()
  resetTenantService()
  setActivePinia(createPinia())
})

describe('useTenantStore', () => {
  it('starts empty with nothing selected', () => {
    const store = useTenantStore()

    expect(store.results).toEqual([])
    expect(store.status).toBe('idle')
    expect(store.selectedTenant).toBeNull()
    expect(store.error).toBeNull()
  })

  it('loads nothing until a property is selected', async () => {
    await useTenantStore().loadTenants()

    expect(getTenants).not.toHaveBeenCalled()
    expect(useTenantStore().status).toBe('idle')
  })

  it('loads the selected property’s tenants without auto-selecting one', async () => {
    const store = await withProperty()

    await store.loadTenants()

    expect(getTenants).toHaveBeenCalledWith(testProperty.id, { search: '' })
    expect(store.results).toEqual(testTenants)
    expect(store.count).toBe(3)
    expect(store.status).toBe('ready')
    expect(store.selectedTenantId).toBeNull()
  })

  it('shows loading while the request is pending', async () => {
    const store = await withProperty()
    const request = deferred()
    getTenants.mockReturnValueOnce(request.promise)

    const loading = store.loadTenants()
    expect(store.loading).toBe(true)

    request.resolve(pageOf(testTenants))
    await loading
    expect(store.loading).toBe(false)
  })

  it('searches through the service and keeps the query the results are for', async () => {
    const store = await withProperty()

    await store.searchTenants('  zahid ')

    expect(getTenants).toHaveBeenLastCalledWith(testProperty.id, { search: 'zahid' })
    expect(store.query).toBe('zahid')
    expect(names(store)).toEqual(['Shaik Zahid Ali'])
  })

  it('never lets an older search replace a newer one', async () => {
    const store = await withProperty()
    const slow = deferred()
    const fast = deferred()
    getTenants.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)

    const first = store.searchTenants('a')
    const second = store.searchTenants('yusuf')
    fast.resolve(pageOf(testTenants, { search: 'yusuf' }))
    await second
    slow.resolve(pageOf(testTenants, { search: 'a' }))
    await first

    expect(store.query).toBe('yusuf')
    expect(names(store)).toEqual(['Mohammed Yusuf'])
  })

  it('reports a failed load as an error, not as no tenants, and retries', async () => {
    const store = await withProperty()
    getTenants.mockRejectedValueOnce(new Error('boom'))

    await store.loadTenants()
    expect(store.status).toBe('error')
    expect(store.error).toBe(TENANTS_LOAD_ERROR_MESSAGE)

    await store.loadTenants()
    expect(store.status).toBe('ready')
    expect(store.error).toBeNull()
    expect(store.results).toHaveLength(3)
  })

  it('words network failures and outages', async () => {
    const store = await withProperty()

    getTenants.mockRejectedValueOnce(new ApiError('network'))
    await store.loadTenants()
    expect(store.error).toMatch(/Couldn't reach the server/)

    getTenants.mockRejectedValueOnce(new ApiError('unavailable'))
    await store.loadTenants()
    expect(store.error).toMatch(/unavailable right now/)

    getTenants.mockRejectedValueOnce(new ApiError('rate-limited'))
    await store.loadTenants()
    expect(store.error).toBe('Too many requests. Wait a minute and try again.')
  })

  describe('load more', () => {
    beforeEach(() => {
      fakeTenancies.pageSize = 2
    })

    it('appends the next page of the same search', async () => {
      const store = await withProperty()
      await store.loadTenants()
      expect(store.hasMore).toBe(true)

      await store.loadMore()

      expect(getTenants).toHaveBeenLastCalledWith(testProperty.id, { search: '', page: 2 })
      expect(names(store)).toEqual(['Shaik Zahid Ali', 'Mohammed Yusuf', 'Ali Hussain'])
      expect(store.hasMore).toBe(false)
    })

    it('keeps the results shown when a page fails, so it can be tried again', async () => {
      const store = await withProperty()
      await store.loadTenants()
      getTenants.mockRejectedValueOnce(new Error('boom'))

      await store.loadMore()
      expect(store.status).toBe('ready')
      expect(store.results).toHaveLength(2)
      expect(store.error).toBe(TENANTS_LOAD_ERROR_MESSAGE)

      await store.loadMore()
      expect(store.results).toHaveLength(3)
      expect(store.error).toBeNull()
    })

    it('is discarded when a new search starts', async () => {
      const store = await withProperty()
      await store.loadTenants()
      const more = deferred()
      getTenants.mockReturnValueOnce(more.promise)

      const loading = store.loadMore()
      await store.searchTenants('ali')
      more.resolve(pageOf(testTenants, { page: 2 }))
      await loading

      expect(store.query).toBe('ali')
      expect(names(store)).toEqual(['Shaik Zahid Ali', 'Ali Hussain'])
      expect(store.loadingMore).toBe(false)
    })
  })

  describe('selection', () => {
    it('keeps the selected tenant’s details when a search leaves it out', async () => {
      const store = await withProperty()
      await store.loadTenants()
      store.selectTenant('tenant-001')

      await store.searchTenants('yusuf')

      expect(names(store)).toEqual(['Mohammed Yusuf'])
      expect(store.selectedTenant?.name).toBe('Shaik Zahid Ali')
    })

    it('ignores an id it has never loaded', async () => {
      const store = await withProperty()
      await store.loadTenants()

      store.selectTenant('tenant-999')

      expect(store.selectedTenantId).toBeNull()
    })

    it('shows the latest details after the tenant changes', async () => {
      const store = await withProperty()
      await store.loadTenants()
      store.selectTenant('tenant-001')

      fakeTenancies.tenants = [{ ...testTenants[0]!, rentAmount: 16000 }]
      await store.loadTenants()

      expect(store.selectedTenant?.rentAmount).toBe(16000)
    })

    it('clears the selection', async () => {
      const store = await withProperty()
      await store.loadTenants()
      store.selectTenant('tenant-002')

      store.clearSelectedTenant()

      expect(store.selectedTenant).toBeNull()
    })
  })

  describe('loadTenant', () => {
    it('loads one tenant through the detail API and remembers it', async () => {
      const store = await withProperty()

      const tenant = await store.loadTenant('tenant-003')

      expect(getTenant).toHaveBeenCalledWith(testProperty.id, 'tenant-003')
      expect(tenant?.name).toBe('Ali Hussain')
      expect(store.getTenant('tenant-003')).toEqual(tenant)
    })

    it('uses a tenant it already has', async () => {
      const store = await withProperty()
      await store.loadTenants()

      expect((await store.loadTenant('tenant-001'))?.name).toBe('Shaik Zahid Ali')
      expect(getTenant).not.toHaveBeenCalled()
    })

    it('returns null for a tenancy the property doesn’t have', async () => {
      const store = await withProperty()

      expect(await store.loadTenant('tenant-999')).toBeNull()
    })

    it('throws other failures, so an outage isn’t "not found"', async () => {
      const store = await withProperty()
      getTenant.mockRejectedValueOnce(new ApiError('unavailable'))

      await expect(store.loadTenant('tenant-001')).rejects.toMatchObject({ kind: 'unavailable' })
    })
  })

  describe('reset', () => {
    it('clears the previous property’s tenants and selection when the property changes', async () => {
      const store = await withProperty([testProperty, annex])
      await store.loadTenants()
      store.selectTenant('tenant-001')

      useAccessStore().selectProperty(annex.id)

      // Immediately, before anything reloads.
      expect(store.selectedTenant).toBeNull()
      expect(store.results).toEqual([])
      expect(store.getTenant('tenant-001')).toBeNull()
      expect(store.status).toBe('idle')
    })

    it('clears everything when property access is cleared (logout or lost access)', async () => {
      const store = await withProperty()
      await store.loadTenants()
      store.selectTenant('tenant-001')

      useAccessStore().clear()

      expect(store.selectedTenant).toBeNull()
      expect(store.results).toEqual([])
    })

    it('discards a response for the previous property', async () => {
      const store = await withProperty([testProperty, annex])
      const pending = deferred()
      getTenants.mockReturnValueOnce(pending.promise)

      const loading = store.loadTenants()
      useAccessStore().selectProperty(annex.id)
      pending.resolve(pageOf(testTenants))
      await loading

      expect(store.results).toEqual([])
      expect(store.status).toBe('idle')
    })

    it('doesn’t remember a tenant loaded for a property the user has left', async () => {
      const store = await withProperty([testProperty, annex])
      let answer!: () => void
      getTenant.mockReturnValueOnce(
        new Promise((resolve) => (answer = () => resolve(testTenants[0]!))),
      )

      const loading = store.loadTenant('tenant-001')
      useAccessStore().selectProperty(annex.id)
      answer()
      await loading

      expect(store.getTenant('tenant-001')).toBeNull()
    })
  })
})
