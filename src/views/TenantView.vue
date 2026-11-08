<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import LatestEntryCard from '@/components/rent/LatestEntryCard.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import TenantDetails from '@/components/tenant/TenantDetails.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAutoRetry } from '@/composables/useAutoRetry'
import { useReceiptDownload } from '@/composables/useReceiptDownload'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import { useRentEntryStore } from '@/stores/rentEntry'

// One tenant: their terms, their latest bill, and the way to their bills, a new bill and their
// meter. Opened from Tenants, the dashboard's search or a link.
const props = defineProps<{ tenantId: string }>()

const router = useRouter()
const accessStore = useAccessStore()
const rentEntryStore = useRentEntryStore()
const {
  tenant,
  status: tenantStatus,
  error: tenantError,
  retry: retryTenant,
} = useRouteTenant(() => props.tenantId)

// Their newest bill and bill count, from the backend, each time the page opens.
watch(
  () => tenant.value?.id ?? null,
  (tenantId) => {
    if (tenantId) rentEntryStore.loadSummary(tenantId)
  },
  { immediate: true },
)

const summary = computed(() => rentEntryStore.summaries[props.tenantId] ?? null)

// null hides the count rather than showing a wrong 0 while loading or after a failure.
const entryCount = computed(() => (summary.value?.status === 'ready' ? summary.value.count : null))

// The newest bill by billing month; null while loading, on failure and when there's none.
const latestBill = computed(() => (summary.value?.status === 'ready' ? summary.value.latest : null))

// Holds the latest bill's place while their bills load or have errored (auto-retry is in
// progress); never collapses to nothing, so it can't read as "no bill".
const summaryLoading = computed(
  () => !summary.value || summary.value.status === 'loading' || summary.value.status === 'error',
)

function retrySummary() {
  rentEntryStore.loadSummary(props.tenantId)
}

useAutoRetry(() => (tenant.value ? (summary.value?.status ?? 'idle') : 'idle'), retrySummary)

// The latest bill's receipt (its most recent payment's), from Django, as a PDF.
const {
  downloadingId: downloadingReceiptId,
  error: receiptError,
  downloadLatestReceipt,
  reset: resetReceiptDownload,
} = useReceiptDownload()
// Another tenant's (or a new) bill: an earlier download's error or wait isn't about this one.
watch(() => latestBill.value?.id, resetReceiptDownload)

function downloadReceipt(entryId: string) {
  void downloadLatestReceipt(props.tenantId, entryId)
}

function openNewEntry() {
  router.push({ name: 'rent-entry-new', params: { tenantId: props.tenantId } })
}

function openEntry(entryId: string) {
  router.push({ name: 'rent-entry-details', params: { tenantId: props.tenantId, entryId } })
}

function openHistory() {
  router.push({ name: 'rent-entry-history', params: { tenantId: props.tenantId } })
}

function openMeter() {
  router.push({ name: 'meter-readings', params: { tenantId: props.tenantId } })
}

function goToTenants() {
  router.push({ name: 'tenants' })
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
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Tenant overview</h1>
    </header>

    <!-- The card's own shape while the tenant loads, so nothing jumps when it arrives. -->
    <LoadingRegion
      v-if="tenantStatus === 'loading'"
      label="Loading tenant…"
      data-testid="tenant-loading"
    >
      <div class="rounded-xl border bg-card p-4 sm:p-6">
        <div class="flex items-center gap-4">
          <Skeleton class="size-12 rounded-full" />
          <div class="space-y-2">
            <Skeleton class="h-6 w-48" />
            <Skeleton class="h-4 w-20" />
          </div>
        </div>
        <SkeletonLines class="mt-6" :lines="3" />
      </div>
    </LoadingRegion>

    <RentEntriesLoadError
      v-else-if="tenantStatus === 'error'"
      :message="tenantError ?? ''"
      @retry="retryTenant"
    />

    <div
      v-else-if="!tenant"
      class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
      role="alert"
    >
      <h2 class="text-lg font-semibold">Tenant not found</h2>
      <p class="mt-1 max-w-sm text-sm text-muted-foreground">
        This tenant doesn't exist or has been removed. Choose one from Tenants.
      </p>
      <Button class="mt-6 h-11 px-6" @click="goToTenants">Go to tenants</Button>
    </div>

    <TenantDetails
      v-else
      class="animate-rise-in"
      :tenant="tenant"
      :entry-count="entryCount"
      @add-entry="openNewEntry"
      @view-entries="openHistory"
      @view-meter="openMeter"
    >
      <template v-if="summaryLoading" #latest-entry>
        <LoadingRegion label="Loading the latest bill…" data-testid="latest-entry-loading">
          <div class="rounded-xl border bg-card p-4 sm:p-5">
            <SkeletonLines heading :lines="4" />
          </div>
        </LoadingRegion>
      </template>
      <template v-else-if="latestBill" #latest-entry>
        <p
          v-if="receiptError"
          class="mb-3 text-sm text-destructive"
          role="alert"
          data-testid="receipt-error"
        >
          {{ receiptError }}
        </p>
        <LatestEntryCard
          :entry="latestBill"
          :downloading-receipt="downloadingReceiptId === latestBill.id"
          @view="openEntry"
          @download-receipt="downloadReceipt"
        />
      </template>
    </TenantDetails>
  </AppLayout>
</template>
