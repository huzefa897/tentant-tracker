import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRouteTenant } from '@/composables/useRouteTenant'
import { ApiError } from '@/services/apiError'
import { tenantService } from '@/services/tenant.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { TENANTS_LOAD_ERROR_MESSAGE, useTenantStore } from '@/stores/tenant'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))

const getTenant = vi.mocked(tenantService.getTenant)

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

beforeEach(async () => {
  resetAuthService()
  resetAccessService()
  resetTenantService()
  setActivePinia(createPinia())
  // As the route guards leave it: signed in with the test property selected.
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
})

describe('useRouteTenant', () => {
  it('loads the tenant in the URL through the detail API', async () => {
    const tenant = mountWith(ref('tenant-002'))
    expect(tenant.status.value).toBe('loading')

    await flushPromises()

    expect(getTenant).toHaveBeenCalledWith(expect.any(String), 'tenant-002')
    expect(tenant.status.value).toBe('ready')
    expect(tenant.tenant.value?.name).toBe('Mohammed Yusuf')
  })

  it('reports an unknown tenant as missing', async () => {
    const tenant = mountWith(ref('tenant-999'))
    await flushPromises()

    expect(tenant.status.value).toBe('missing')
    expect(tenant.tenant.value).toBeNull()
  })

  it('loads again when the id changes', async () => {
    const id = ref('tenant-001')
    const tenant = mountWith(id)
    await flushPromises()

    id.value = 'tenant-003'
    expect(tenant.status.value).toBe('loading')
    await flushPromises()

    expect(tenant.tenant.value?.name).toBe('Ali Hussain')
  })

  it('uses a tenant the dashboard already loaded, without a request', async () => {
    await useTenantStore().loadTenants()

    const tenant = mountWith(ref('tenant-001'))

    expect(tenant.status.value).toBe('ready')
    expect(getTenant).not.toHaveBeenCalled()
  })

  it('reports a failed load as an error, not a missing tenant, and retries', async () => {
    getTenant.mockRejectedValueOnce(new Error('boom'))
    const tenant = mountWith(ref('tenant-001'))
    await flushPromises()

    expect(tenant.status.value).toBe('error')
    expect(tenant.error.value).toBe(TENANTS_LOAD_ERROR_MESSAGE)

    await tenant.retry()

    expect(tenant.status.value).toBe('ready')
    expect(tenant.error.value).toBeNull()
  })

  it('ignores a slow answer for an id the page has moved on from', async () => {
    let failOld!: () => void
    getTenant.mockReturnValueOnce(
      new Promise((_, reject) => (failOld = () => reject(new ApiError('unavailable')))),
    )
    const id = ref('tenant-001')
    const tenant = mountWith(id)

    id.value = 'tenant-002'
    await flushPromises()
    failOld()
    await flushPromises()

    expect(tenant.status.value).toBe('ready')
    expect(tenant.tenant.value?.name).toBe('Mohammed Yusuf')
  })
})
