<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

import TenantList from '@/components/tenant/TenantList.vue'
import { useAutoRetry } from '@/composables/useAutoRetry'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import { useTenantStore } from '@/stores/tenant'

// The selected property's current tenants; each opens its tenant page.
const router = useRouter()
const accessStore = useAccessStore()
const tenantStore = useTenantStore()

// Every tenant each time it opens, not the last search.
onMounted(() => tenantStore.searchTenants(''))

useAutoRetry(
  () => tenantStore.status,
  () => tenantStore.searchTenants(),
)

function openTenant(tenantId: string) {
  router.push({ name: 'tenant', params: { tenantId } })
}
</script>

<template>
  <AppLayout>
    <header class="mb-6">
      <p
        v-if="accessStore.selectedProperty"
        class="mb-1 text-sm font-semibold text-primary"
        data-testid="selected-property"
      >
        {{ accessStore.selectedProperty.name }}
      </p>
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Tenants</h1>
    </header>

    <TenantList
      :tenants="tenantStore.results"
      :query="tenantStore.query"
      :status="tenantStore.status"
      :error="tenantStore.error"
      :has-more="tenantStore.hasMore"
      :loading-more="tenantStore.loadingMore"
      @open="openTenant"
      @search="tenantStore.searchTenants"
      @load-more="tenantStore.loadMore"
      @retry="tenantStore.searchTenants()"
    />
  </AppLayout>
</template>
