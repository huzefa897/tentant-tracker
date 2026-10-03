import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { mockTenants } from '@/data/tenants.mock'
import type { Tenant } from '@/types/tenant'

export const useTenantStore = defineStore('tenant', () => {
  const tenants = ref<Tenant[]>([])
  // Store the id, not a copy, so selectedTenant always reflects the latest tenants list.
  const selectedTenantId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const selectedTenant = computed(
    () => tenants.value.find((tenant) => tenant.id === selectedTenantId.value) ?? null,
  )

  // Mock data for now; becomes `await tenantService.getTenants()` without callers changing.
  async function loadTenants() {
    loading.value = true
    error.value = null

    try {
      tenants.value = mockTenants
    } catch {
      error.value = 'Unable to load tenants. Please try again.'
    } finally {
      loading.value = false
    }
  }

  function selectTenant(tenantId: string) {
    selectedTenantId.value = tenantId
  }

  function clearSelectedTenant() {
    selectedTenantId.value = null
  }

  return {
    tenants,
    selectedTenantId,
    selectedTenant,
    loading,
    error,
    loadTenants,
    selectTenant,
    clearSelectedTenant,
  }
})
