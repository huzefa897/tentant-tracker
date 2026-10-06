<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftRight, LogOut, Users } from '@lucide/vue'

import LatestEntryCard from '@/components/rent/LatestEntryCard.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import TenantDetails from '@/components/tenant/TenantDetails.vue'
import TenantSelector from '@/components/tenant/TenantSelector.vue'
import { Button } from '@/components/ui/button'
import { useLogout } from '@/composables/useLogout'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import { useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import type { RentEntry } from '@/types/rentEntry'
import { sortPaymentsNewestFirst } from '@/utils/rentCalculations'

const accessStore = useAccessStore()
const tenantStore = useTenantStore()
const rentEntryStore = useRentEntryStore()
const router = useRouter()
const handleLogout = useLogout()

onMounted(() => {
  // The full list: the selector's search box starts empty.
  tenantStore.searchTenants('')
  rentEntryStore.initialize()
})

// null hides the count rather than showing a wrong 0 when entries didn't load.
const selectedTenantEntryCount = computed(() => {
  const tenantId = tenantStore.selectedTenantId

  if (!tenantId || !rentEntryStore.initialized) return null

  return rentEntryStore.getEntriesForTenant(tenantId).length
})

// The selected tenant's most recent bill (by billing month), with what's been paid against it.
// null until entries load, and when the tenant has none.
const latestBill = computed(() => {
  const tenantId = tenantStore.selectedTenantId

  if (!tenantId || !rentEntryStore.initialized) return null

  const entry = rentEntryStore
    .getEntriesForTenant(tenantId)
    .reduce<RentEntry | null>(
      (latest, item) => (!latest || item.billingMonth > latest.billingMonth ? item : latest),
      null,
    )

  if (!entry) return null

  const payments = sortPaymentsNewestFirst(rentEntryStore.getPaymentsForEntry(entry.id))

  return {
    entry,
    totalPaid: rentEntryStore.getTotalPaid(entry.id),
    lastPaidDate: payments[0]?.paidDate ?? null,
  }
})

function switchProperty() {
  router.push({ name: 'property-select' })
}

function openNewEntry() {
  const tenant = tenantStore.selectedTenant
  if (!tenant) return

  router.push({ name: 'rent-entry-new', params: { tenantId: tenant.id } })
}

function openEntry(entryId: string) {
  const tenant = tenantStore.selectedTenant
  if (!tenant) return

  // The summary's back button then returns here rather than to Previous Entries.
  router.push({
    name: 'rent-entry-details',
    params: { tenantId: tenant.id, entryId },
    query: { from: 'dashboard' },
  })
}

function openHistory() {
  const tenant = tenantStore.selectedTenant
  if (!tenant) return

  router.push({ name: 'rent-entry-history', params: { tenantId: tenant.id } })
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <div class="flex w-full items-center gap-2 sm:w-auto">
        <div class="min-w-0 flex-1 sm:w-80">
          <TenantSelector
            :tenants="tenantStore.results"
            :selected-tenant="tenantStore.selectedTenant"
            :query="tenantStore.query"
            :status="tenantStore.status"
            :error="tenantStore.error"
            :has-more="tenantStore.hasMore"
            :loading-more="tenantStore.loadingMore"
            @select="tenantStore.selectTenant"
            @search="tenantStore.searchTenants"
            @load-more="tenantStore.loadMore"
          />
        </div>
        <Button
          v-if="accessStore.properties.length > 1"
          variant="ghost"
          size="icon"
          class="size-11 shrink-0 text-muted-foreground"
          aria-label="Switch property"
          title="Switch property"
          @click="switchProperty"
        >
          <ArrowLeftRight class="size-5!" />
        </Button>
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
      <p
        v-if="accessStore.selectedProperty"
        class="mb-1 text-sm font-semibold text-primary"
        data-testid="selected-property"
      >
        {{ accessStore.selectedProperty.name }}
      </p>
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Tenant Overview</h1>
      <p class="mt-2 text-muted-foreground">
        View tenant details, rent information and manage entries.
      </p>
    </header>

    <RentEntriesLoadError
      v-if="tenantStore.status === 'error' && tenantStore.error"
      class="mb-6"
      data-testid="tenants-error"
      :message="tenantStore.error"
      @retry="tenantStore.loadTenants"
    />

    <RentEntriesLoadError
      v-if="rentEntryStore.loadError"
      class="mb-6"
      :message="rentEntryStore.loadError"
      @retry="rentEntryStore.initialize"
    />

    <!-- Keyed, so switching tenants plays the rise-in again. -->
    <TenantDetails
      v-if="tenantStore.selectedTenant"
      :key="tenantStore.selectedTenant.id"
      class="animate-rise-in"
      :tenant="tenantStore.selectedTenant"
      :entry-count="selectedTenantEntryCount"
      @add-entry="openNewEntry"
      @view-entries="openHistory"
    >
      <template v-if="latestBill" #latest-entry>
        <LatestEntryCard
          :entry="latestBill.entry"
          :total-paid="latestBill.totalPaid"
          :last-paid-date="latestBill.lastPaidDate"
          @view="openEntry"
        />
      </template>
    </TenantDetails>

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
