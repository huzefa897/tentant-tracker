<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, History, Plus, User } from '@lucide/vue'

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
import { getEntryAmounts, sumEntryAmounts } from '@/utils/rentCalculations'

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

onMounted(() => rentEntryStore.initialize())

const tenantEntries = computed(() => rentEntryStore.getEntriesForTenant(props.tenantId))

// YYYY-MM sorts as text. Copy first: sort() would reorder the store's array.
const sortedEntries = computed(() =>
  [...tenantEntries.value].sort((a, b) => b.billingMonth.localeCompare(a.billingMonth)),
)

const years = computed(() => [
  ...new Set(sortedEntries.value.map((entry) => entry.billingMonth.slice(0, 4))),
])

const selectedYear = ref('all')
const selectedStatus = ref<PaymentStatus | 'all'>('all')

// Each bill with the sum of its payments, so filters, rows and totals agree.
const filteredBills = computed(() =>
  sortedEntries.value
    .map((entry) => ({ entry, totalPaid: rentEntryStore.getTotalPaid(entry.id) }))
    .filter(({ entry, totalPaid }) => {
      const matchesYear =
        selectedYear.value === 'all' || entry.billingMonth.startsWith(`${selectedYear.value}-`)
      const matchesStatus =
        selectedStatus.value === 'all' ||
        getEntryAmounts(entry, totalPaid).status === selectedStatus.value

      return matchesYear && matchesStatus
    }),
)

const totals = computed(() => sumEntryAmounts(filteredBills.value))

function clearFilters() {
  selectedYear.value = 'all'
  selectedStatus.value = 'all'
}

// The router reuses this page when only the tenant in the URL changes; one tenant's filters
// shouldn't hide another's entries.
watch(
  () => props.tenantId,
  () => {
    clearFilters()
    clearReceiptError()
  },
)

function goToDashboard() {
  router.push({ name: 'dashboard' })
}

function addEntry() {
  router.push({ name: 'rent-entry-new', params: { tenantId: props.tenantId } })
}

function viewEntry(entryId: string) {
  router.push({ name: 'rent-entry-details', params: { tenantId: props.tenantId, entryId } })
}

const {
  downloadingPaymentId,
  error: receiptError,
  downloadReceipt,
  clearError: clearReceiptError,
} = useReceiptDownload()

const downloadingEntryId = computed(() =>
  downloadingPaymentId.value
    ? (rentEntryStore.payments.find((payment) => payment.id === downloadingPaymentId.value)
        ?.entryId ?? null)
    : null,
)

// Downloads the receipt for the bill's most recently recorded payment, issued first if needed.
// It shows the bill's total paid to date. Each payment's own receipt is on the summary page.
function downloadBillReceipt(entryId: string) {
  const payment = rentEntryStore.getPaymentsForEntry(entryId).slice(-1)[0]
  if (payment) downloadReceipt(payment.id)
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
        v-if="rentEntryStore.loadError"
        :message="rentEntryStore.loadError"
        @retry="rentEntryStore.initialize"
      />

      <p v-else-if="!rentEntryStore.initialized" class="text-muted-foreground" role="status">
        Loading entries…
      </p>

      <div
        v-else-if="sortedEntries.length === 0"
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
          <RentEntryTotals v-if="filteredBills.length > 0" :totals="totals" />
        </div>

        <template v-if="filteredBills.length > 0">
          <p
            v-if="receiptError"
            class="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
            data-testid="receipt-error"
          >
            {{ receiptError }}
          </p>
          <RentEntryHistory
            :bills="filteredBills"
            :downloading-entry-id="downloadingEntryId"
            @view="viewEntry"
            @download-receipt="downloadBillReceipt"
          />
        </template>

        <div
          v-else
          class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-10 text-center"
        >
          <p class="text-muted-foreground">No entries match these filters.</p>
          <Button variant="outline" class="mt-4 h-11 px-6" @click="clearFilters">
            Clear filters
          </Button>
        </div>
      </div>
    </template>
  </AppLayout>
</template>
