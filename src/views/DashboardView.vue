<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ChevronLeft, ChevronRight } from '@lucide/vue'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import DashboardSummary from '@/components/dashboard/DashboardSummary.vue'
import NotOwedForm from '@/components/dashboard/NotOwedForm.vue'
import PeriodFilterBar from '@/components/dashboard/PeriodFilterBar.vue'
import RefreshStatus from '@/components/dashboard/RefreshStatus.vue'
import RentalPeriodTable from '@/components/dashboard/RentalPeriodTable.vue'
import LatestEntryCard from '@/components/rent/LatestEntryCard.vue'
import TenantDetails from '@/components/tenant/TenantDetails.vue'
import TenantSelector from '@/components/tenant/TenantSelector.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAutoRetry } from '@/composables/useAutoRetry'
import { useReceiptDownload } from '@/composables/useReceiptDownload'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import { useDashboardStore } from '@/stores/dashboard'
import { useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import type { PreparationFilter, RentalPeriodRow, TimingFilter } from '@/types/dashboard'
import { recentMonths } from '@/utils/rentalPeriods'

const accessStore = useAccessStore()
const tenantStore = useTenantStore()
const rentEntryStore = useRentEntryStore()
const dashboardStore = useDashboardStore()
const router = useRouter()

onMounted(() => {
  // The full list: the selector's search box starts empty.
  tenantStore.searchTenants('')
})

// Rent due, the default view: refreshed every time it's shown (opening the dashboard,
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

// Months per page, as the API returns them (backend RentalPeriodsPagination).
const PERIODS_PAGE_SIZE = 20

const timing = computed({
  get: () => dashboardStore.filters.timing,
  set: (next: TimingFilter) => dashboardStore.setTiming(next),
})
const preparation = computed({
  get: () => dashboardStore.filters.preparation,
  set: (next: PreparationFilter) => dashboardStore.setPreparation(next),
})
const month = computed({
  get: () => dashboardStore.filters.month,
  set: (next: string | null) => dashboardStore.setMonth(next),
})

// The last year of rental months, from today at the property.
const filterMonths = computed(() =>
  dashboardStore.summary ? recentMonths(dashboardStore.summary.asOfDate) : [],
)

const periods = computed(() => dashboardStore.periods)
const periodsPageCount = computed(() =>
  Math.max(1, Math.ceil((periods.value?.count ?? 0) / PERIODS_PAGE_SIZE)),
)

const NOTHING_OWED: Record<TimingFilter, string> = {
  due: 'No rent is due or overdue.',
  overdue: 'Nothing is overdue.',
  due_today: 'Nothing is due today.',
  upcoming: 'Nothing is due in the next 7 days.',
  all: 'No rent is owed.',
}
const nothingShown = computed(() =>
  dashboardStore.filters.preparation === 'all' && !dashboardStore.filters.month
    ? NOTHING_OWED[dashboardStore.filters.timing]
    : 'No months match these filters.',
)

function prepareBill(period: RentalPeriodRow) {
  router.push({
    name: 'rent-entry-new',
    params: { tenantId: period.tenantId },
    query: { month: period.periodMonth },
  })
}

function openBill(period: RentalPeriodRow, pay = false) {
  if (!period.billId) return
  router.push({
    name: 'rent-entry-details',
    params: { tenantId: period.tenantId, entryId: period.billId },
    query: pay ? { from: 'dashboard', pay: '1' } : { from: 'dashboard' },
  })
}

// Mark not owed: the month being confirmed, in a dialog that stays open while it saves.
const notOwedPeriod = ref<RentalPeriodRow | null>(null)

function askNotOwed(period: RentalPeriodRow) {
  dashboardStore.clearMarkError()
  notOwedPeriod.value = period
}

function setNotOwedOpen(open: boolean) {
  if (open || dashboardStore.markingId) return
  notOwedPeriod.value = null
}

async function saveNotOwed(reason: string) {
  const period = notOwedPeriod.value
  if (period && (await dashboardStore.markNotOwed(period.id, reason))) notOwedPeriod.value = null
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
        Rent due
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

    <!-- Rent due: the default view, until a tenant is chosen above. -->
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
          <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Rent due</h1>
          <p class="mt-2 text-muted-foreground">
            Which months are due or overdue, bill or no bill.
          </p>
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
        label="Loading rent due…"
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

        <section class="mt-10" aria-labelledby="periods-heading">
          <h2 id="periods-heading" class="mb-4 text-xl font-semibold">Rental months</h2>
          <PeriodFilterBar
            v-model:timing="timing"
            v-model:preparation="preparation"
            v-model:month="month"
            class="mb-4"
            :months="filterMonths"
            @clear="dashboardStore.setFilters({ preparation: 'all', month: null })"
          />

          <LoadingRegion
            v-if="dashboardStore.periodsStatus === 'loading'"
            label="Loading rental months…"
            data-testid="periods-loading"
          >
            <SkeletonRows bordered :rows="Math.max(1, periods?.periods.length ?? 4)" />
          </LoadingRegion>
          <div
            v-else-if="dashboardStore.periodsStatus === 'error'"
            class="rounded-xl border border-dashed px-4 py-6 text-center"
            data-testid="periods-error"
          >
            <p class="text-destructive" role="alert">{{ dashboardStore.periodsError }}</p>
            <Button variant="outline" class="mt-3 h-11" @click="dashboardStore.retryPeriods">
              Try again
            </Button>
          </div>
          <template v-else-if="periods && dashboardStore.summary">
            <RentalPeriodTable
              v-if="periods.periods.length"
              :key="`${timing}-${preparation}-${month}-${periods.page}`"
              class="animate-rise-in"
              :periods="periods.periods"
              :as-of-date="dashboardStore.summary.asOfDate"
              @prepare="prepareBill"
              @view="openBill"
              @record="openBill($event, true)"
              @not-owed="askNotOwed"
            />
            <p
              v-else
              class="rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground"
              data-testid="periods-empty"
            >
              {{ nothingShown }}
            </p>

            <nav
              v-if="periods.hasNext || periods.hasPrevious"
              class="mt-4 flex items-center justify-between gap-3"
              aria-label="Pages"
            >
              <Button
                variant="outline"
                class="h-11"
                :disabled="!periods.hasPrevious"
                @click="dashboardStore.goToPage(periods.page - 1)"
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <p class="text-sm text-muted-foreground" data-testid="periods-page-position">
                Page {{ periods.page }} of {{ periodsPageCount }} · {{ periods.count }}
                {{ periods.count === 1 ? 'month' : 'months' }}
              </p>
              <Button
                variant="outline"
                class="h-11"
                :disabled="!periods.hasNext"
                @click="dashboardStore.goToPage(periods.page + 1)"
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          </template>
        </section>

        <Dialog :open="notOwedPeriod !== null" @update:open="setNotOwedOpen">
          <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Mark month not owed</DialogTitle>
              <DialogDescription
                >For rent that was waived or settled outside the app.</DialogDescription
              >
            </DialogHeader>
            <NotOwedForm
              v-if="notOwedPeriod"
              :period="notOwedPeriod"
              :saving="dashboardStore.markingId === notOwedPeriod.id"
              :save-error="dashboardStore.markError"
              @save="saveNotOwed"
              @cancel="setNotOwedOpen(false)"
            />
          </DialogContent>
        </Dialog>
      </template>
    </div>
  </AppLayout>
</template>
