<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ChevronLeft, ChevronRight, History, Plus, User } from '@lucide/vue'

import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import RentEntryFilters from '@/components/rent/RentEntryFilters.vue'
import RentEntryHistory from '@/components/rent/RentEntryHistory.vue'
import RentEntryTotals from '@/components/rent/RentEntryTotals.vue'
import { Button } from '@/components/ui/button'
import { useReceiptDownload } from '@/composables/useReceiptDownload'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { useRentEntryStore } from '@/stores/rentEntry'
import type { PaymentStatus } from '@/types/rentEntry'
import { formatPaymentStatus, sumEntryAmounts } from '@/utils/rentCalculations'

// The URL is the source of truth, never the dashboard's selected tenant, so a saved link
// always shows the tenant it names.
const props = defineProps<{
  tenantId: string
}>()

const rentEntryStore = useRentEntryStore()
const router = useRouter()

const {
  tenant,
  status: tenantStatus,
  error: tenantError,
  retry: retryTenants,
} = useRouteTenant(() => props.tenantId)

// Bills per page, as the API returns them (backend billing/views.py RentEntryPagination).
const PAGE_SIZE = 12

const selectedYear = ref('all')
const selectedStatus = ref<PaymentStatus | 'all'>('all')
const page = ref(1)

const filtered = computed(() => selectedYear.value !== 'all' || selectedStatus.value !== 'all')

// The backend filters (before paging) and pages; this page asks for what's shown.
function load() {
  rentEntryStore.loadHistory(props.tenantId, {
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
    selectedYear.value = 'all'
    selectedStatus.value = 'all'
    page.value = 1
    load()
  },
  { immediate: true },
)

// Both filters change together on Clear filters: one reload, not two. A filter or page shows
// other bills, so an earlier bill's receipt download no longer shows or holds the buttons.
watch([selectedYear, selectedStatus], () => {
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
const totals = computed(() => sumEntryAmounts(entries.value))

// What the empty result is for, e.g. "No paid entries in 2026."
const noMatchesMessage = computed(() => {
  const status =
    selectedStatus.value === 'all'
      ? ''
      : `${formatPaymentStatus(selectedStatus.value).toLowerCase()} `
  const year = selectedYear.value === 'all' ? '' : ` in ${selectedYear.value}`
  return `No ${status}entries${year}.`
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

function viewEntry(entryId: string) {
  router.push({ name: 'rent-entry-details', params: { tenantId: props.tenantId, entryId } })
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <Button variant="ghost" class="h-11 text-muted-foreground" @click="goToDashboard">
        <ArrowLeft aria-hidden="true" />
        Back to Dashboard
      </Button>
    </template>

    <p v-if="tenantStatus === 'loading'" class="text-muted-foreground" role="status">Loading…</p>

    <RentEntriesLoadError
      v-else-if="tenantStatus === 'error'"
      :message="tenantError ?? ''"
      @retry="retryTenants"
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
      <Button class="mt-6 h-11 px-6" @click="goToDashboard">Back to Dashboard</Button>
    </div>

    <template v-else>
      <header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Previous Entries</h1>
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
          Add New Entry
        </Button>
      </header>

      <!-- A failed load must never look like an empty history or a zero balance. -->
      <RentEntriesLoadError
        v-if="history.status === 'error'"
        :message="history.error ?? ''"
        @retry="load"
      />

      <p v-else-if="history.status !== 'ready'" class="text-muted-foreground" role="status">
        Loading entries…
      </p>

      <div
        v-else-if="history.count === 0 && !filtered"
        class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
      >
        <div
          class="mb-4 flex size-14 items-center justify-center rounded-full bg-secondary text-primary"
          aria-hidden="true"
        >
          <History class="size-7" />
        </div>
        <p class="max-w-sm text-muted-foreground">
          No rent entries yet. Add the first entry for this tenant.
        </p>
        <Button class="mt-6 h-11 px-6" @click="addEntry">
          <Plus aria-hidden="true" />
          Add New Entry
        </Button>
      </div>

      <div v-else class="space-y-6">
        <!-- Wide screens: filters and totals share a row, so the table starts higher. -->
        <div class="grid gap-6 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] xl:items-end">
          <RentEntryFilters
            v-model:year="selectedYear"
            v-model:status="selectedStatus"
            :years="years"
          />
          <RentEntryTotals v-if="entries.length > 0" :totals="totals" />
        </div>

        <template v-if="entries.length > 0">
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
              Page {{ history.page }} of {{ pageCount }} · {{ history.count }} entries
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
