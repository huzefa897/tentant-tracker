import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRouteTenant } from '@/composables/useRouteTenant'
import { useTenantStore } from '@/stores/tenant'

function mountWith(tenantId: Ref<string>) {
  let result!: ReturnType<typeof useRouteTenant>
  mount(
    defineComponent({
      setup() {
        result = useRouteTenant(tenantId)
        return () => null
      },
    }),
  )
  return result
}

function failNextLoad() {
  const store = useTenantStore()
  const realLoad = store.loadTenants
  vi.spyOn(store, 'loadTenants')
    .mockImplementationOnce(async () => {
      store.error = 'Unable to load tenants. Please try again.'
    })
    .mockImplementation(realLoad)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

describe('useRouteTenant', () => {
  it('loads tenants on mount and finds the one in the URL', async () => {
    const tenant = mountWith(ref('tenant-002'))
    expect(tenant.status.value).toBe('loading')

    await flushPromises()

    expect(tenant.status.value).toBe('ready')
    expect(tenant.tenant.value?.name).toBe('Mohammed Yusuf')
  })

  it('reports an unknown tenant as missing', async () => {
    const tenant = mountWith(ref('tenant-999'))
    await flushPromises()

    expect(tenant.status.value).toBe('missing')
    expect(tenant.tenant.value).toBeNull()
  })

  it('follows the id when it changes', async () => {
    const id = ref('tenant-001')
    const tenant = mountWith(id)
    await flushPromises()

    id.value = 'tenant-003'

    expect(tenant.tenant.value?.name).toBe('Ali Hussain')
  })

  it('doesn’t reload tenants that are already loaded', async () => {
    await useTenantStore().loadTenants()
    const load = vi.spyOn(useTenantStore(), 'loadTenants')

    const tenant = mountWith(ref('tenant-001'))

    expect(tenant.status.value).toBe('ready')
    expect(load).not.toHaveBeenCalled()
  })

  it('reports a failed load as an error, not a missing tenant, and retries', async () => {
    failNextLoad()
    const tenant = mountWith(ref('tenant-001'))
    await flushPromises()

    expect(tenant.status.value).toBe('error')
    expect(tenant.error.value).toBe('Unable to load tenants. Please try again.')

    await tenant.retry()

    expect(tenant.status.value).toBe('ready')
    expect(tenant.error.value).toBeNull()
  })
})
