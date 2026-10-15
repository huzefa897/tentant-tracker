<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ChevronLeft, ChevronRight } from '@lucide/vue'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import DashboardSummary from '@/components/dashboard/DashboardSummary.vue'
import DueFilterGroup from '@/components/dashboard/DueFilterGroup.vue'
import MissingBillsList from '@/components/dashboard/MissingBillsList.vue'
import MonthStepper from '@/components/dashboard/MonthStepper.vue'
import PendingTenancyList from '@/components/dashboard/PendingTenancyList.vue'
import RefreshStatus from '@/components/dashboard/RefreshStatus.vue'
import LatestEntryCard from '@/components/rent/LatestEntryCard.vue'
import TenantDetails from '@/components/tenant/TenantDetails.vue'
import TenantSelector from '@/components/tenant/TenantSelector.vue'
import { Button } from '@/components/ui/button'
import { useAutoRetry } from '@/composables/useAutoRetry'
import { useReceiptDownload } from '@/composables/useReceiptDownload'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import { useDashboardStore } from '@/stores/dashboard'
import { useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import type { DueFilter } from '@/types/dashboard'

const accessStore = useAccessStore()
const tenantStore = useTenantStore()
const rentEntryStore = useRentEntryStore()
const dashboardStore = useDashboardStore()
const router = useRouter()

onMounted(() => {
  // The full list: the selector's search box starts empty.
  tenantStore.searchTenants('')
})

// Pending payments, the default view: refreshed every time it's shown (opening the dashboard,
// coming back from a payment, reversal, new or corrected bill, or another property), keeping
// what's already shown while it loads.
watch(
  () => [accessStore.selectedPropertyId, tenantStore.selectedTenantId] as const,
  ([propertyId, tenantId]) => {
    if (propertyId && !tenantId) void dashboardStore.refresh()
  },
  { immediate: true },
)
useAutoRetry(
  () => dashboardStore.status,
  () => dashboardStore.refresh(),
)

// Tenancies per page, as the API returns them (backend PendingTenanciesPagination).
const PENDING_PAGE_SIZE = 20

const dueFilter = computed({
  get: () => dashboardStore.dueFilter,
  set: (next: DueFilter) => dashboardStore.setDueFilter(next),
})

const missingMonth = computed({
  get: () => dashboardStore.missing?.billingMonth ?? '',
  set: (month: string) => dashboardStore.setMissingMonth(month),
})

const pending = computed(() => dashboardStore.pending)
const pendingPageCount = computed(() =>
  Math.max(1, Math.ceil((pending.value?.count ?? 0) / PENDING_PAGE_SIZE)),
)

const NOTHING_PENDING: Record<DueFilter, string> = {
  all: 'No one owes money on recorded bills.',
  overdue: 'Nothing is overdue.',
  due_today: 'Nothing is due today.',
  due_next_7_days: 'Nothing is due in the next 7 days.',
}

function viewPendingBills(tenantId: string) {
  router.push({
    name: 'rent-entry-history',
    params: { tenantId },
    query: { status: 'outstanding' },
  })
}

function createMissingBill(tenantId: string, billingMonth: string) {
  router.push({ name: 'rent-entry-new', params: { tenantId }, query: { month: billingMonth } })
}

// The selected tenant's newest bill and bill count, from the backend, each time a tenant is
// selected (and when returning here with one selected).
watch(
  () => tenantStore.selectedTenantId,
  (tenantId) => {
    if (tenantId) rentEntryStore.loadSummary(tenantId)
  },
  { immediate: true },
)

const summary = computed(() => {
  const tenantId = tenantStore.selectedTenantId
  return tenantId ? (rentEntryStore.summaries[tenantId] ?? null) : null
})

// null hides the count rather than showing a wrong 0 while loading or after a failure.
const selectedTenantEntryCount = computed(() =>
  summary.value?.status === 'ready' ? summary.value.count : null,
)

// The newest bill by billing month; null while loading, on failure and when there's none.
const latestBill = computed(() => (summary.value?.status === 'ready' ? summary.value.latest : null))

// Holds the latest entry's place while the selected tenant's bills load or have errored
// (auto-retry is in progress); never collapses to nothing so it can't read as "no entry".
const summaryLoading = computed(
  () =>
    !!tenantStore.selectedTenantId &&
    (!summary.value || summary.value.status === 'loading' || summary.value.status === 'error'),
)

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
  const tenant = tenantStore.selectedTenant
  if (tenant) void downloadLatestReceipt(tenant.id, entryId)
}

function retrySummary() {
  if (tenantStore.selectedTenantId) rentEntryStore.loadSummary(tenantStore.selectedTenantId)
}

useAutoRetry(
  () => tenantStore.status,
  () => tenantStore.searchTenants(),
)
useAutoRetry(() => summary.value?.status ?? 'idle', retrySummary)

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
    <template #toolbar>
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
    </template>

    <template v-if="tenantStore.selectedTenant">
      <Button
        variant="ghost"
        class="mb-4 -ml-3 h-10"
        data-testid="back-to-pending"
        @click="tenantStore.clearSelectedTenant"
      >
        <ArrowLeft aria-hidden="true" />
        Pending payments
      </Button>
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
    </template>

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
      <template v-if="summaryLoading" #latest-entry>
        <LoadingRegion label="Loading the latest entry…" data-testid="latest-entry-loading">
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

    <!-- Pending payments: the default view, until a tenant is chosen above. -->
    <div v-else data-testid="pending-payments">
      <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p
            v-if="accessStore.selectedProperty"
            class="mb-1 text-sm font-semibold text-primary"
            data-testid="selected-property"
          >
            {{ accessStore.selectedProperty.name }}
          </p>
          <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Pending payments</h1>
          <p class="mt-2 text-muted-foreground">Who owes money, and how late it is.</p>
        </div>
        <RefreshStatus
          v-if="dashboardStore.loaded"
          :loaded-at="dashboardStore.loadedAt"
          :refreshing="dashboardStore.refreshing"
          :error="dashboardStore.refreshError"
          @refresh="dashboardStore.refresh"
        />
      </header>

      <!-- The first load: the shapes of what's coming, never zeros. -->
      <LoadingRegion
        v-if="!dashboardStore.loaded && dashboardStore.status !== 'error'"
        label="Loading pending payments…"
        data-testid="dashboard-loading"
      >
        <SkeletonLines card :lines="4" />
        <SkeletonRows class="mt-10" bordered :rows="4" />
      </LoadingRegion>

      <div
        v-else-if="!dashboardStore.loaded"
        class="rounded-2xl border border-dashed px-6 py-10 text-center"
        data-testid="dashboard-error"
      >
        <p class="text-destructive" role="alert">{{ dashboardStore.error }}</p>
        <Button class="mt-4 h-11" @click="dashboardStore.refresh">Try again</Button>
      </div>

      <template v-else>
        <DashboardSummary v-if="dashboardStore.summary" :summary="dashboardStore.summary" />

        <section class="mt-10" aria-labelledby="pending-heading">
          <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="pending-heading" class="text-xl font-semibold">Who owes</h2>
            <DueFilterGroup v-model="dueFilter" />
          </div>

          <LoadingRegion
            v-if="dashboardStore.pendingStatus === 'loading'"
            label="Loading tenants…"
            data-testid="pending-loading"
          >
            <SkeletonRows bordered :rows="Math.max(1, pending?.tenancies.length ?? 4)" />
          </LoadingRegion>
          <div
            v-else-if="dashboardStore.pendingStatus === 'error'"
            class="rounded-xl border border-dashed px-4 py-6 text-center"
            data-testid="pending-error"
          >
            <p class="text-destructive" role="alert">{{ dashboardStore.pendingError }}</p>
            <Button variant="outline" class="mt-3 h-11" @click="dashboardStore.retryPending">
              Try again
            </Button>
          </div>
          <template v-else-if="pending">
            <PendingTenancyList
              v-if="pending.tenancies.length"
              :key="`${dueFilter}-${pending.page}`"
              class="animate-rise-in"
              :tenancies="pending.tenancies"
              @view="viewPendingBills"
            />
            <p
              v-else
              class="rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground"
              data-testid="pending-empty"
            >
              {{ NOTHING_PENDING[dueFilter] }}
            </p>

            <nav
              v-if="pending.hasNext || pending.hasPrevious"
              class="mt-4 flex items-center justify-between gap-3"
              aria-label="Pages"
            >
              <Button
                variant="outline"
                class="h-11"
                :disabled="!pending.hasPrevious"
                @click="dashboardStore.goToPage(pending.page - 1)"
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <p class="text-sm text-muted-foreground" data-testid="pending-page-position">
                Page {{ pending.page }} of {{ pendingPageCount }} · {{ pending.count }} tenants
              </p>
              <Button
                variant="outline"
                class="h-11"
                :disabled="!pending.hasNext"
                @click="dashboardStore.goToPage(pending.page + 1)"
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          </template>
        </section>

        <section class="mt-10" aria-labelledby="missing-heading">
          <div class="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 id="missing-heading" class="text-xl font-semibold">Missing bills</h2>
            <MonthStepper
              v-if="dashboardStore.missing"
              v-model="missingMonth"
              :disabled="dashboardStore.missingStatus === 'loading'"
            />
          </div>
          <p class="mb-4 text-sm text-muted-foreground">
            Occupied flats with no bill for the month. They aren’t counted in the totals above.
          </p>

          <LoadingRegion
            v-if="dashboardStore.missingStatus === 'loading'"
            label="Loading missing bills…"
            data-testid="missing-loading"
          >
            <SkeletonRows bordered :rows="2" />
          </LoadingRegion>
          <div
            v-else-if="dashboardStore.missingStatus === 'error'"
            class="rounded-xl border border-dashed px-4 py-6 text-center"
            data-testid="missing-error"
          >
            <p class="text-destructive" role="alert">{{ dashboardStore.missingError }}</p>
            <Button variant="outline" class="mt-3 h-11" @click="dashboardStore.retryMissing">
              Try again
            </Button>
          </div>
          <MissingBillsList
            v-else-if="dashboardStore.missing"
            :key="dashboardStore.missing.billingMonth"
            class="animate-rise-in"
            :missing="dashboardStore.missing"
            @create="createMissingBill"
          />
        </section>
      </template>
    </div>
  </AppLayout>
</template>
