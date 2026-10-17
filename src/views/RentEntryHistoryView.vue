<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ChevronLeft, ChevronRight, History, Plus, User } from '@lucide/vue'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import SlowLoadScreen from '@/components/common/SlowLoadScreen.vue'
import RentEntryFilters from '@/components/rent/RentEntryFilters.vue'
import RentEntryHistory from '@/components/rent/RentEntryHistory.vue'
import RentEntryTotals from '@/components/rent/RentEntryTotals.vue'
import TenantChipSkeleton from '@/components/tenant/TenantChipSkeleton.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAutoRetry } from '@/composables/useAutoRetry'
import { useReceiptDownload } from '@/composables/useReceiptDownload'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { useRentEntryStore } from '@/stores/rentEntry'
import type { EntryStatusFilter } from '@/types/rentEntry'
import { formatEntryStatusFilter, sumEntryAmounts } from '@/utils/rentCalculations'

// The URL is the source of truth, never the dashboard's selected tenant, so a saved link
// always shows the tenant it names.
const props = defineProps<{
  tenantId: string
}>()

const rentEntryStore = useRentEntryStore()
const route = useRoute()
const router = useRouter()

// ?status=outstanding opens the tenant's bills with money still to pay (the dashboard's View
// bills); anything else starts unfiltered.
function initialStatus(): EntryStatusFilter | 'all' {
  return route.query.status === 'outstanding' ? 'outstanding' : 'all'
}

const {
  tenant,
  status: tenantStatus,
  error: tenantError,
  retryable: tenantRetryable,
} = useRouteTenant(() => props.tenantId)

// Bills per page, as the API returns them (backend billing/views.py RentEntryPagination).
const PAGE_SIZE = 12

const selectedYear = ref('all')
const selectedStatus = ref<EntryStatusFilter | 'all'>(initialStatus())
const showVoid = ref(false)
const page = ref(1)

const filtered = computed(() => selectedYear.value !== 'all' || selectedStatus.value !== 'all')

// After this tenant's first page has shown, a reload (another filter or page) keeps the filters
// on screen and puts skeleton rows where the bills were, as many as there were, so the page
// doesn't jump.
const historyShown = ref(false)
const skeletonRows = ref(4)

// The backend filters (before paging) and pages; this page asks for what's shown.
function load() {
  rentEntryStore.loadHistory(props.tenantId, {
    includeVoid: showVoid.value,
    year: selectedYear.value === 'all' ? null : selectedYear.value,
    paymentStatus: selectedStatus.value === 'all' ? null : selectedStatus.value,
    page: page.value,
  })
}

// A bill's receipt (its most recent payment's), from Django, as a PDF.
const {
  downloadingId: downloadingReceiptId,
  error: receiptError,
  downloadLatestReceipt,
  reset: resetReceiptDownload,
} = useReceiptDownload()

function downloadReceipt(entryId: string) {
  void downloadLatestReceipt(props.tenantId, entryId)
}

// The router reuses this page when only the tenant in the URL changes; one tenant's filter
// and page shouldn't apply to another's entries.
watch(
  () => props.tenantId,
  () => {
    resetReceiptDownload()
    historyShown.value = false
    selectedYear.value = 'all'
    selectedStatus.value = initialStatus()
    showVoid.value = false
    page.value = 1
    load()
  },
  { immediate: true },
)

// Both filters change together on Clear filters: one reload, not two. A filter or page shows
// other bills, so an earlier bill's receipt download no longer shows or holds the buttons.
watch([selectedYear, selectedStatus, showVoid], () => {
  resetReceiptDownload()
  page.value = 1
  load()
})

function goToPage(next: number) {
  resetReceiptDownload()
  page.value = next
  load()
}

const history = computed(() => rentEntryStore.history)
const entries = computed(() => history.value.entries)

watch(
  () => history.value.status === 'ready' && history.value.tenantId === props.tenantId,
  (ready) => {
    if (!ready) return
    historyShown.value = true
    skeletonRows.value = Math.min(Math.max(entries.value.length, 1), PAGE_SIZE)
  },
)
const pageCount = computed(() => Math.max(1, Math.ceil(history.value.count / PAGE_SIZE)))

// Years the tenancy covers, newest first: bills can only be for months it overlaps.
const years = computed(() => {
  if (!tenant.value) return []
  const first = Number(tenant.value.startDate.slice(0, 4))
  const last = tenant.value.endDate
    ? Number(tenant.value.endDate.slice(0, 4))
    : Math.max(new Date().getFullYear(), first)
  return Array.from({ length: last - first + 1 }, (_, i) => String(last - i))
})

// This page's bills only: a tenant's other pages aren't loaded, so this is never their balance.
// Void bills count for nothing.
const totals = computed(() => sumEntryAmounts(entries.value))
const voidCount = computed(() => entries.value.filter((e) => e.billStatus === 'void').length)

// What the empty result is for, e.g. "No paid bills in 2026."
const noMatchesMessage = computed(() => {
  const status =
    selectedStatus.value === 'all'
      ? ''
      : `${formatEntryStatusFilter(selectedStatus.value).toLowerCase()} `
  const year = selectedYear.value === 'all' ? '' : ` in ${selectedYear.value}`
  return `No ${status}bills${year}.`
})

// All the matching bills, across pages.
const entriesCountLabel = computed(() =>
  history.value.count === 1 ? '1 bill' : `${history.value.count} bills`,
)

const allVoidMessage = computed(() => {
  const count = history.value.hiddenVoidCount
  return count === 1
    ? 'No active bills. The only bill is void, so it’s hidden.'
    : `No active bills. All ${count} bills are void, so they’re hidden.`
})

function clearFilters() {
  selectedYear.value = 'all'
  selectedStatus.value = 'all'
}

function goToDashboard() {
  router.push({ name: 'dashboard' })
}

function addEntry() {
  router.push({ name: 'rent-entry-new', params: { tenantId: props.tenantId } })
}

useAutoRetry(() => history.value.status, load)

function viewEntry(entryId: string) {
  router.push({ name: 'rent-entry-details', params: { tenantId: props.tenantId, entryId } })
}
</script>

<template>
  <AppLayout>
    <template #back>
      <Button
        variant="ghost"
        class="-ml-3 h-11 text-primary hover:text-primary"
        @click="goToDashboard"
      >
        <ArrowLeft aria-hidden="true" />
        Back to dashboard
      </Button>
    </template>

    <!-- The page's own shape while it loads, so nothing jumps when the bills arrive. -->
    <LoadingRegion
      v-if="tenantStatus === 'loading'"
      label="Loading bills…"
      data-testid="history-loading"
    >
      <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-3xl font-bold tracking-tight sm:text-4xl">Bills</p>
          <TenantChipSkeleton />
        </div>
        <Skeleton class="h-11 w-44" />
      </div>
      <div class="space-y-6">
        <Skeleton class="h-[7.5rem] w-full rounded-xl" />
        <SkeletonRows bordered />
      </div>
    </LoadingRegion>

    <SlowLoadScreen
      v-else-if="tenantStatus === 'error'"
      :error="tenantError"
      :retryable="tenantRetryable"
    />

    <div
      v-else-if="!tenant"
      class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
      role="alert"
    >
      <h1 class="text-lg font-semibold">Tenant not found</h1>
      <p class="mt-1 max-w-sm text-sm text-muted-foreground">
        This tenant doesn't exist or has been removed. Choose a tenant from the dashboard.
      </p>
      <Button class="mt-6 h-11 px-6" @click="goToDashboard">Back to dashboard</Button>
    </div>

    <template v-else>
      <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Bills</h1>
          <p
            class="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm text-secondary-foreground"
            data-testid="tenant-chip"
          >
            <User class="size-4" aria-hidden="true" />
            {{ tenant.name }} · Flat {{ tenant.flatNumber }}
          </p>
        </div>
        <Button class="h-11 px-6" @click="addEntry">
          <Plus aria-hidden="true" />
          New bill
        </Button>
      </header>

      <LoadingRegion
        v-if="history.status !== 'ready' && !historyShown"
        label="Loading bills…"
        data-testid="history-loading"
      >
        <div class="space-y-6">
          <Skeleton class="h-[7.5rem] w-full rounded-xl" />
          <SkeletonRows bordered />
        </div>
      </LoadingRegion>

      <div
        v-else-if="
          history.status === 'ready' &&
          history.count === 0 &&
          !filtered &&
          history.hiddenVoidCount === 0
        "
        class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
      >
        <div
          class="mb-4 flex size-14 items-center justify-center rounded-full bg-secondary text-primary"
          aria-hidden="true"
        >
          <History class="size-7" />
        </div>
        <p class="max-w-sm text-muted-foreground">
          No bills yet. Add the first bill for this tenant.
        </p>
        <Button class="mt-6 h-11 px-6" @click="addEntry">
          <Plus aria-hidden="true" />
          New bill
        </Button>
      </div>

      <div v-else class="space-y-6">
        <RentEntryTotals
          v-if="history.status === 'ready' && entries.length > 0"
          :totals="totals"
          :void-count="voidCount"
        />
        <!-- Holds the totals' space while another page or filter loads. -->
        <Skeleton
          v-else-if="history.status !== 'ready'"
          class="h-[18.5rem] sm:h-28"
          aria-hidden="true"
        />

        <section aria-labelledby="entries-heading" class="rounded-xl border">
          <div class="flex items-baseline justify-between gap-4 border-b px-4 py-3 sm:px-5">
            <h2 id="entries-heading" class="text-lg font-semibold">Bills</h2>
            <p
              v-if="history.status === 'ready'"
              class="text-sm text-muted-foreground tabular-nums"
              data-testid="entries-count"
            >
              {{ entriesCountLabel }}
            </p>
          </div>
          <div class="p-3 sm:px-4">
            <RentEntryFilters
              v-model:year="selectedYear"
              v-model:status="selectedStatus"
              v-model:show-void="showVoid"
              :years="years"
            />
          </div>
        </section>

        <LoadingRegion
          v-if="history.status !== 'ready'"
          label="Loading bills…"
          data-testid="history-loading"
        >
          <SkeletonRows bordered :rows="skeletonRows" />
        </LoadingRegion>

        <template v-else-if="entries.length > 0">
          <p v-if="receiptError" class="text-sm text-destructive" role="alert">
            {{ receiptError }}
          </p>
          <RentEntryHistory
            :entries="entries"
            :downloading-entry-id="downloadingReceiptId"
            @view="viewEntry"
            @download-receipt="downloadReceipt"
          />

          <nav
            v-if="history.hasNext || history.hasPrevious"
            class="flex items-center justify-between gap-3"
            aria-label="Pages"
          >
            <Button
              variant="outline"
              class="h-11"
              :disabled="!history.hasPrevious"
              @click="goToPage(history.page - 1)"
            >
              <ChevronLeft aria-hidden="true" />
              Newer
            </Button>
            <p class="text-sm text-muted-foreground" data-testid="page-position">
              Page {{ history.page }} of {{ pageCount }} · {{ entriesCountLabel }}
            </p>
            <Button
              variant="outline"
              class="h-11"
              :disabled="!history.hasNext"
              @click="goToPage(history.page + 1)"
            >
              Older
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </template>

        <!-- Every bill is void: they're hidden, not missing. -->
        <div
          v-else-if="history.hiddenVoidCount > 0"
          class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-10 text-center"
          data-testid="all-bills-void"
        >
          <p class="max-w-sm text-muted-foreground">{{ allVoidMessage }}</p>
          <div class="mt-4 flex flex-wrap justify-center gap-3">
            <Button variant="outline" class="h-11 px-6" @click="showVoid = true">
              Show void bills
            </Button>
            <Button class="h-11 px-6" @click="addEntry">
              <Plus aria-hidden="true" />
              New bill
            </Button>
          </div>
        </div>

        <div
          v-else
          class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-10 text-center"
        >
          <p class="text-muted-foreground">{{ noMatchesMessage }}</p>
          <Button variant="outline" class="mt-4 h-11 px-6" @click="clearFilters">
            Clear filters
          </Button>
        </div>
      </div>
    </template>
  </AppLayout>
</template>
