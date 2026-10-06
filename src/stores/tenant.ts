import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { ApiError } from '@/services/apiError'
import { tenantService } from '@/services/tenant.service'
import { useAccessStore } from '@/stores/access'
import type { Tenant } from '@/types/tenant'

export type TenantListStatus = 'idle' | 'loading' | 'ready' | 'error'

export const TENANTS_LOAD_ERROR_MESSAGE = 'Unable to load tenants. Please try again.'

export function tenantErrorMessage(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'

  switch (kind) {
    case 'network':
      return "Couldn't reach the server. Check your connection and try again."
    case 'unavailable':
      return 'Tenants are unavailable right now. Please try again shortly.'
    case 'unauthorized':
      return "Your sign-in couldn't be verified. Log out and sign in again."
    default:
      return TENANTS_LOAD_ERROR_MESSAGE
  }
}

// The selected property's tenants (tenancies) from the backend. Search results and the
// details of tenants already seen are kept apart: a new search can drop the selected tenant
// from the results, but never from the selection.
export const useTenantStore = defineStore('tenant', () => {
  const accessStore = useAccessStore()

  // The current search results (one or more pages) and the query they're for.
  const results = ref<Tenant[]>([])
  const query = ref('')
  const count = ref(0)
  const page = ref(0)
  const hasMore = ref(false)
  const status = ref<TenantListStatus>('idle')
  const loadingMore = ref(false)
  const error = ref<string | null>(null)

  // Every tenant loaded for this property, by tenancy id: from results and detail requests.
  const tenantsById = ref<Record<string, Tenant>>({})
  // Store the id, not a copy, so the selection shows the latest details.
  const selectedTenantId = ref<string | null>(null)

  const loading = computed(() => status.value === 'loading')
  const selectedTenant = computed(() =>
    selectedTenantId.value ? (tenantsById.value[selectedTenantId.value] ?? null) : null,
  )

  // Each list request gets a number; only the newest may change state, so a slow older search
  // never replaces a newer one. reset() also bumps it, discarding responses for the old property.
  let requestSeq = 0

  function remember(tenants: Tenant[]) {
    const next = { ...tenantsById.value }
    for (const tenant of tenants) next[tenant.id] = tenant
    tenantsById.value = next
  }

  // The first page of results for a query. Also the initial load and Retry.
  async function searchTenants(search = query.value) {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return

    const seq = ++requestSeq
    query.value = search.trim()
    status.value = 'loading'
    loadingMore.value = false
    error.value = null

    try {
      const result = await tenantService.getTenants(propertyId, { search: query.value })
      if (seq !== requestSeq) return

      remember(result.tenants)
      results.value = result.tenants
      count.value = result.count
      page.value = result.page
      hasMore.value = result.hasMore
      status.value = 'ready'
    } catch (err) {
      if (seq !== requestSeq) return

      results.value = []
      count.value = 0
      page.value = 0
      hasMore.value = false
      error.value = tenantErrorMessage(err)
      status.value = 'error'
    }
  }

  function loadTenants() {
    return searchTenants(query.value)
  }

  // The next page of the current results.
  async function loadMore() {
    const propertyId = accessStore.selectedPropertyId
    if (!propertyId || status.value !== 'ready' || !hasMore.value || loadingMore.value) return

    const seq = ++requestSeq
    loadingMore.value = true
    error.value = null

    try {
      const result = await tenantService.getTenants(propertyId, {
        search: query.value,
        page: page.value + 1,
      })
      if (seq !== requestSeq) return

      remember(result.tenants)
      const seen = new Set(results.value.map((tenant) => tenant.id))
      results.value = [...results.value, ...result.tenants.filter((t) => !seen.has(t.id))]
      count.value = result.count
      page.value = result.page
      hasMore.value = result.hasMore
    } catch (err) {
      if (seq !== requestSeq) return
      // The results already shown stay; Load more can be tried again.
      error.value = tenantErrorMessage(err)
    } finally {
      if (seq === requestSeq) loadingMore.value = false
    }
  }

  function getTenant(tenantId: string): Tenant | null {
    return tenantsById.value[tenantId] ?? null
  }

  // One tenant by id, for pages opened by URL: from the cache, or the detail API. null when
  // this property has no such tenancy; other failures throw (an outage isn't "not found").
  async function loadTenant(tenantId: string): Promise<Tenant | null> {
    const cached = getTenant(tenantId)
    if (cached) return cached

    const propertyId = accessStore.selectedPropertyId
    if (!propertyId) return null

    try {
      const tenant = await tenantService.getTenant(propertyId, tenantId)
      // Not cached under a property the user has since left.
      if (accessStore.selectedPropertyId === propertyId) remember([tenant])
      return tenant
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'not-found') return null
      throw err
    }
  }

  function selectTenant(tenantId: string) {
    if (getTenant(tenantId)) selectedTenantId.value = tenantId
  }

  function clearSelectedTenant() {
    selectedTenantId.value = null
  }

  // Forget everything about the previous property (or user), and ignore its pending responses.
  function reset() {
    requestSeq++
    results.value = []
    query.value = ''
    count.value = 0
    page.value = 0
    hasMore.value = false
    status.value = 'idle'
    loadingMore.value = false
    error.value = null
    tenantsById.value = {}
    selectedTenantId.value = null
  }

  // Switching property, logging out and losing access all change the selected property.
  watch(
    () => accessStore.selectedPropertyId,
    (next, previous) => {
      if (next !== previous) reset()
    },
    { flush: 'sync' },
  )

  return {
    results,
    query,
    count,
    hasMore,
    status,
    loading,
    loadingMore,
    error,
    selectedTenantId,
    selectedTenant,
    searchTenants,
    loadTenants,
    loadMore,
    getTenant,
    loadTenant,
    selectTenant,
    clearSelectedTenant,
    reset,
  }
})
