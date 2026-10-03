import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { mockTenants } from '@/data/tenants.mock'
import { useTenantStore } from '@/stores/tenant'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useTenantStore', () => {
  it('starts empty with nothing selected', () => {
    const store = useTenantStore()

    expect(store.tenants).toEqual([])
    expect(store.selectedTenantId).toBeNull()
    expect(store.selectedTenant).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('loads tenants without auto-selecting one', async () => {
    const store = useTenantStore()

    await store.loadTenants()

    expect(store.tenants).toEqual(mockTenants)
    expect(store.selectedTenantId).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('resolves selectedTenant from the selected id', async () => {
    const store = useTenantStore()
    await store.loadTenants()

    store.selectTenant('tenant-002')

    expect(store.selectedTenantId).toBe('tenant-002')
    expect(store.selectedTenant?.name).toBe('Mohammed Yusuf')
  })

  it('clears the selection', async () => {
    const store = useTenantStore()
    await store.loadTenants()
    store.selectTenant('tenant-001')

    store.clearSelectedTenant()

    expect(store.selectedTenantId).toBeNull()
    expect(store.selectedTenant).toBeNull()
  })

  it('returns null for an id that matches no tenant', async () => {
    const store = useTenantStore()
    await store.loadTenants()

    store.selectTenant('tenant-999')

    expect(store.selectedTenant).toBeNull()
  })

  it('keeps a selection that still exists after reloading', async () => {
    const store = useTenantStore()
    store.selectTenant('tenant-002')

    await store.loadTenants()

    expect(store.selectedTenantId).toBe('tenant-002')
  })

  it('drops a stale selection after reloading', async () => {
    const store = useTenantStore()
    store.selectTenant('tenant-999')

    await store.loadTenants()

    expect(store.selectedTenantId).toBeNull()
  })
})
