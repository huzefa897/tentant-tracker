<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ChevronLeft, ChevronRight } from '@lucide/vue'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import DashboardSummary from '@/components/dashboard/DashboardSummary.vue'
import NotOwedForm from '@/components/dashboard/NotOwedForm.vue'
import OverdueFilterBar from '@/components/dashboard/OverdueFilterBar.vue'
import OverdueTenantList from '@/components/dashboard/OverdueTenantList.vue'
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
import { useOverdueStore } from '@/stores/overdue'
import { useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import type {
  OverdueBill,
  OverdueTenant,
  PreparationFilter,
  RentalPeriodRow,
  TimingFilter,
} from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'
import { formatOverdueBillCount } from '@/utils/overdueBills'
import { formatTenantCount, recentMonths } from '@/utils/rentalPeriods'

const accessStore = useAccessStore()
const tenantStore = useTenantStore()
const rentEntryStore = useRentEntryStore()
const dashboardStore = useDashboardStore()
const overdueStore = useOverdueStore()
const route = useRoute()
const router = useRouter()

// Two lists: rent due (the default): every month due or overdue, bill or no bill, where a month
// without a bill gets one prepared; and overdue bills (?view=overdue).
type DashboardTab = 'overdue' | 'rent-due'
const tab = computed<DashboardTab>(() => (route.query.view === 'overdue' ? 'overdue' : 'rent-due'))
const tabs: { value: DashboardTab; label: string }[] = [
  { value: 'rent-due', label: 'Rent due' },
  { value: 'overdue', label: 'Overdue bills' },
]

function showTab(next: DashboardTab) {
  if (next !== tab.value) router.replace({ query: next === 'overdue' ? { view: next } : {} })
}

onMounted(() => {
  // The full list: the selector's search box starts empty.
  tenantStore.searchTenants('')
})

// Each list is refreshed every time it's shown (opening the dashboard, coming back from a
// payment, reversal, new or corrected bill, or another property), keeping what's already shown
// while it loads.
watch(
  () => [tab.value, accessStore.selectedPropertyId, tenantStore.selectedTenantId] as const,
  ([shown, propertyId, tenantId]) => {
    if (tenantId) return
    if (shown === 'overdue') void overdueStore.refresh()
    else if (propertyId) void dashboardStore.refresh()
  },
  { immediate: true },
)
useAutoRetry(
  () => (tab.value === 'rent-due' ? dashboardStore.status : 'idle'),
  () => dashboardStore.refresh(),
)
useAutoRetry(
  () => (tab.value === 'overdue' ? overdueStore.status : 'idle'),
  () => overdueStore.refresh(),
)

// Overdue bills: across every property, so a bill or tenant elsewhere selects its property
// first (the bill pages work within the selected one).
const overdue = computed(() => overdueStore.bills)
const overdueProperties = computed(() => accessStore.properties)
// Two years of billing months, from today at the property.
const overdueMonths = computed(() =>
  overdue.value ? recentMonths(overdue.value.asOfDate, 24) : [],
)

const overduePropertyId = computed({
  get: () => overdueStore.filters.propertyId,
  set: (next: string | null) => void overdueStore.setFilters({ propertyId: next }),
})
const overdueMonth = computed({
  get: () => overdueStore.filters.month,
  set: (next: string | null) => void overdueStore.setFilters({ month: next }),
})
const overdueSearch = computed({
  get: () => overdueStore.filters.search,
  set: (next: string) => void overdueStore.setFilters({ search: next }),
})

function withPropertyOf(tenant: OverdueTenant) {
  if (tenant.propertyId !== accessStore.selectedPropertyId) {
    accessStore.selectProperty(tenant.propertyId)
  }
}

function openOverdueBill(tenant: OverdueTenant, bill: OverdueBill) {
  withPropertyOf(tenant)
  router.push({
    name: 'rent-entry-details',
    params: { tenantId: tenant.tenantId, entryId: bill.id },
    query: { from: 'dashboard' },
  })
}

function openOverdueTenant(tenant: OverdueTenant) {
  withPropertyOf(tenant)
  router.push({ name: 'rent-entry-history', params: { tenantId: tenant.tenantId } })
}

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

// Each timing's count across the property, for its tab; only while nothing else narrows the
// list, since the summary never changes with the filters.
const timingCounts = computed(() => {
  const s = dashboardStore.summary
  if (!s || dashboardStore.filters.preparation !== 'all' || dashboardStore.filters.month) {
    return undefined
  }
  return {
    due: s.overduePeriodCount + s.dueTodayPeriodCount,
    overdue: s.overduePeriodCount,
    due_today: s.dueTodayPeriodCount,
    upcoming: s.upcomingPeriodCount,
    all: s.owedPeriodCount,
  }
})

// Read out before the list: "Rental months overdue, awaiting a bill, oldest due first".
const TIMING_CAPTIONS: Record<TimingFilter, string> = {
  due: 'due now (overdue or due today)',
  overdue: 'overdue',
  due_today: 'due today',
  upcoming: 'due in the next 7 days',
  all: 'still owed',
}
const periodsCaption = computed(() => {
  const { timing, preparation, month } = dashboardStore.filters
  return [
    `Rental months ${TIMING_CAPTIONS[timing]}`,
    preparation === 'prepared' ? 'with a prepared bill' : null,
    preparation === 'not_prepared' ? 'awaiting a bill' : null,
    month ? `for ${formatMonthValue(month)}` : null,
    'oldest due first',
  ]
    .filter(Boolean)
    .join(', ')
})

// The summary's "Show them": every owed month whose bill isn't prepared, due or not yet.
function showUnbilled() {
  dashboardStore.setFilters({ timing: 'all', preparation: 'not_prepared', month: null })
}

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

  // The summary's back button then returns here rather than to Bills.
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
        {{ tab === 'overdue' ? 'Overdue bills' : 'Rent due' }}
      </Button>
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

    <!-- The two lists, until a tenant is chosen above. -->
    <template v-else>
      <div
        class="mb-6 flex gap-1 rounded-xl border bg-muted/40 p-1 sm:w-fit"
        role="group"
        aria-label="Show"
      >
        <button
          v-for="option in tabs"
          :key="option.value"
          type="button"
          class="h-10 flex-1 rounded-lg px-4 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm sm:flex-none"
          :aria-pressed="tab === option.value"
          :data-testid="`dashboard-tab-${option.value}`"
          @click="showTab(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <!-- Overdue bills. -->
      <div v-if="tab === 'overdue'" data-testid="overdue-bills">
        <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Overdue bills</h1>
            <p class="mt-2 text-muted-foreground">
              Bills past their due date with money still to pay, oldest first.
            </p>
          </div>
          <RefreshStatus
            v-if="overdueStore.loaded"
            :loaded-at="overdueStore.loadedAt"
            :refreshing="overdueStore.refreshing"
            :error="overdueStore.refreshError"
            @refresh="overdueStore.refresh"
          />
        </header>

        <!-- The first load: the shapes of what's coming, never an empty list. -->
        <LoadingRegion
          v-if="!overdueStore.loaded && overdueStore.status !== 'error'"
          label="Loading overdue bills…"
          data-testid="overdue-loading"
        >
          <SkeletonLines :lines="1" />
          <SkeletonRows class="mt-6" bordered :rows="4" />
        </LoadingRegion>

        <div
          v-else-if="!overdueStore.loaded"
          class="rounded-2xl border border-dashed px-6 py-10 text-center"
          data-testid="overdue-error"
        >
          <p class="text-destructive" role="alert">{{ overdueStore.error }}</p>
          <Button class="mt-4 h-11" @click="overdueStore.refresh">Try again</Button>
        </div>

        <template v-else-if="overdue">
          <OverdueFilterBar
            v-model:property-id="overduePropertyId"
            v-model:month="overdueMonth"
            v-model:search="overdueSearch"
            class="mb-4"
            :properties="overdueProperties"
            :months="overdueMonths"
            @clear="overdueStore.clearFilters"
          />

          <LoadingRegion
            v-if="overdueStore.listStatus === 'loading'"
            label="Loading overdue bills…"
            data-testid="overdue-list-loading"
          >
            <SkeletonRows bordered :rows="Math.max(1, Math.min(overdue.billCount, 6))" />
          </LoadingRegion>
          <div
            v-else-if="overdueStore.listStatus === 'error'"
            class="rounded-xl border border-dashed px-4 py-6 text-center"
            data-testid="overdue-list-error"
          >
            <p class="text-destructive" role="alert">{{ overdueStore.listError }}</p>
            <Button variant="outline" class="mt-3 h-11" @click="overdueStore.refresh">
              Try again
            </Button>
          </div>
          <template v-else>
            <p
              v-if="overdue.tenantCount"
              class="mb-4 text-sm text-muted-foreground"
              data-testid="overdue-totals"
            >
              <span class="text-base font-semibold text-foreground tabular-nums">{{
                formatINR(overdue.totalOutstanding)
              }}</span>
              outstanding · {{ formatTenantCount(overdue.tenantCount) }} ·
              {{ formatOverdueBillCount(overdue.billCount) }}
            </p>
            <OverdueTenantList
              v-if="overdue.tenants.length"
              :key="JSON.stringify(overdueStore.filters)"
              class="animate-rise-in"
              :tenants="overdue.tenants"
              :show-property="overdueProperties.length > 1"
              @view-bill="openOverdueBill"
              @view-tenant="openOverdueTenant"
            />
            <div
              v-else
              class="rounded-xl border border-dashed px-4 py-8 text-center"
              data-testid="overdue-empty"
            >
              <template v-if="overdueStore.filtered">
                <p class="text-muted-foreground">No overdue bills match your filters.</p>
                <Button variant="outline" class="mt-3 h-11" @click="overdueStore.clearFilters">
                  Clear filters
                </Button>
              </template>
              <p v-else class="text-muted-foreground">No overdue bills.</p>
            </div>
          </template>
        </template>
      </div>

      <!-- Rent due: every month due or overdue, bill or no bill. -->
      <div v-else data-testid="pending-payments">
        <header class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
              Track which months are due and overdue, bill or no bill.
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
          <DashboardSummary
            v-if="dashboardStore.summary"
            :summary="dashboardStore.summary"
            @show-unbilled="showUnbilled"
          />

          <section
            class="mt-4 overflow-hidden rounded-xl border bg-card pt-3 sm:pt-4 lg:pt-2"
            aria-labelledby="periods-heading"
          >
            <PeriodFilterBar
              v-model:timing="timing"
              v-model:preparation="preparation"
              v-model:month="month"
              :months="filterMonths"
              :counts="timingCounts"
              @clear="dashboardStore.setFilters({ preparation: 'all', month: null })"
            >
              <template #heading>
                <h2 id="periods-heading" class="sr-only">Rental months</h2>
              </template>
            </PeriodFilterBar>

            <LoadingRegion
              v-if="dashboardStore.periodsStatus === 'loading'"
              label="Loading rental months…"
              class="p-4 sm:p-5"
              data-testid="periods-loading"
            >
              <SkeletonRows :rows="Math.max(1, periods?.periods.length ?? 4)" />
            </LoadingRegion>
            <div
              v-else-if="dashboardStore.periodsStatus === 'error'"
              class="px-4 py-8 text-center"
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
                :caption="periodsCaption"
                @prepare="prepareBill"
                @view="openBill"
                @record="openBill($event, true)"
                @not-owed="askNotOwed"
              />
              <p
                v-else
                class="px-4 py-10 text-center text-muted-foreground"
                data-testid="periods-empty"
              >
                {{ nothingShown }}
              </p>

              <nav
                v-if="periods.hasNext || periods.hasPrevious"
                class="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"
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
    </template>
  </AppLayout>
</template>
