import { computed, onMounted, ref, toValue, type MaybeRefOrGetter } from 'vue'

import { useTenantStore } from '@/stores/tenant'

export type RouteTenantStatus = 'loading' | 'error' | 'missing' | 'ready'

// The tenant named in the URL, for pages that can be opened directly. A failed load shows as
// 'error' (with retry), never as 'missing', so an outage doesn't read as "tenant not found".
export function useRouteTenant(tenantId: MaybeRefOrGetter<string>) {
  const tenantStore = useTenantStore()
  const loaded = ref(tenantStore.tenants.length > 0)

  const tenant = computed(() => tenantStore.tenants.find((t) => t.id === toValue(tenantId)) ?? null)

  const status = computed<RouteTenantStatus>(() => {
    if (tenantStore.error) return 'error'
    if (!loaded.value) return 'loading'
    return tenant.value ? 'ready' : 'missing'
  })

  async function load() {
    await tenantStore.loadTenants()
    loaded.value = tenantStore.error === null
  }

  onMounted(() => {
    if (!loaded.value) load()
  })

  return { tenant, status, error: computed(() => tenantStore.error), retry: load }
}
