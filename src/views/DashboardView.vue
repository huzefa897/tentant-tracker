<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, Users } from '@lucide/vue'

import TenantDetails from '@/components/tenant/TenantDetails.vue'
import TenantSelector from '@/components/tenant/TenantSelector.vue'
import { Button } from '@/components/ui/button'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useTenantStore } from '@/stores/tenant'

const authStore = useAuthStore()
const tenantStore = useTenantStore()
const router = useRouter()

onMounted(() => {
  tenantStore.loadTenants()
})

async function handleLogout() {
  tenantStore.clearSelectedTenant()
  await authStore.logout()
  await router.replace({ name: 'login' })
}

function openNewEntry() {
  const tenant = tenantStore.selectedTenant
  if (!tenant) return

  router.push({ name: 'rent-entry-new', params: { tenantId: tenant.id } })
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <div class="flex w-full items-center gap-2 sm:w-auto">
        <div class="min-w-0 flex-1 sm:w-80">
          <TenantSelector
            :tenants="tenantStore.tenants"
            :selected-tenant-id="tenantStore.selectedTenantId"
            :disabled="tenantStore.loading"
            @select="tenantStore.selectTenant"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="size-11 shrink-0 text-muted-foreground"
          aria-label="Logout"
          title="Logout"
          @click="handleLogout"
        >
          <LogOut class="size-5!" />
        </Button>
      </div>
    </template>

    <header class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Tenant Overview</h1>
      <p class="mt-2 text-muted-foreground">
        View tenant details, rent information and manage entries.
      </p>
    </header>

    <p v-if="tenantStore.error" class="mb-6 text-sm text-destructive" role="alert">
      {{ tenantStore.error }}
    </p>

    <TenantDetails
      v-if="tenantStore.selectedTenant"
      :tenant="tenantStore.selectedTenant"
      @add-entry="openNewEntry"
    />

    <div
      v-else
      class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
    >
      <div
        class="mb-4 flex size-14 items-center justify-center rounded-full bg-secondary text-primary"
        aria-hidden="true"
      >
        <Users class="size-7" />
      </div>
      <h2 class="text-lg font-semibold">Select a tenant</h2>
      <p class="mt-1 max-w-sm text-sm text-muted-foreground">
        Search for a tenant by name or flat number to view their details.
      </p>
    </div>
  </AppLayout>
</template>
