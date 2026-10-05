<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, CircleCheck, User } from '@lucide/vue'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import { Button } from '@/components/ui/button'
import { useRouteEntry } from '@/composables/useRouteEntry'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { useTenantStore } from '@/stores/tenant'
import { formatINR } from '@/utils/currency'
import { formatMonthValue, formatTimestamp } from '@/utils/date'

const props = defineProps<{
  tenantId: string
  entryId: string
  // Where the page was opened from, so the back button returns there.
  from?: 'dashboard' | 'history'
}>()

const tenantStore = useTenantStore()
const router = useRouter()

const {
  tenant,
  status: tenantStatus,
  error: tenantError,
  retry: retryTenants,
} = useRouteTenant(() => props.tenantId)

// Loaded from the backend by its URL, matched on both ids, so it survives a refresh and never
// shows under another tenant.
const {
  entry,
  status: entryStatus,
  error: entryError,
  retry: retryEntry,
} = useRouteEntry(
  () => props.tenantId,
  () => props.entryId,
)

// Rent and rate come from the entry, not the tenant: the tenant's current rates may have
// changed. The amounts are the backend's.
const charges = computed(() => {
  const value = entry.value
  if (!value) return []

  return [
    { label: 'Rent', value: formatINR(value.rentAmount) },
    { label: 'Electricity units', value: String(value.electricityUnits) },
    { label: 'Electricity rate', value: `${formatINR(value.electricityRate)} / unit` },
    { label: 'Electricity amount', value: formatINR(value.electricityAmount) },
    { label: 'Water', value: formatINR(value.waterAmount) },
  ]
})

function goToDashboard() {
  router.push({ name: 'dashboard' })
}

// Back to the dashboard with this tenant selected, as it was when the summary was opened (a
// refresh clears the selection).
function backToDashboard() {
  if (tenant.value) tenantStore.selectTenant(tenant.value.id)
  goToDashboard()
}

// Explicit route, not router.back(): a direct link has no in-app page to go back to.
function goToHistory() {
  router.push({ name: 'rent-entry-history', params: { tenantId: props.tenantId } })
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <Button
        v-if="tenant && from !== 'dashboard'"
        variant="ghost"
        class="h-11 text-muted-foreground"
        @click="goToHistory"
      >
        <ArrowLeft aria-hidden="true" />
        Back to Previous Entries
      </Button>
      <Button v-else variant="ghost" class="h-11 text-muted-foreground" @click="backToDashboard">
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

    <RentEntriesLoadError
      v-else-if="entryStatus === 'error'"
      :message="entryError ?? ''"
      @retry="retryEntry"
    />

    <p v-else-if="entryStatus === 'loading'" class="text-muted-foreground" role="status">
      Loading entry…
    </p>

    <div
      v-else-if="!entry"
      class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
      role="alert"
    >
      <h1 class="text-lg font-semibold">Entry not found</h1>
      <p class="mt-1 max-w-sm text-sm text-muted-foreground">
        This entry doesn't exist for {{ tenant.name }}, Flat {{ tenant.flatNumber }}.
      </p>
      <Button class="mt-6 h-11 px-6" @click="goToHistory">Back to Previous Entries</Button>
    </div>

    <template v-else>
      <header class="mb-6">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">
            {{ formatMonthValue(entry.billingMonth) }}
          </h1>
          <PaymentStatusBadge :status="entry.status" />
        </div>
        <p
          class="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm text-secondary-foreground"
          data-testid="tenant-chip"
        >
          <User class="size-4" aria-hidden="true" />
          {{ tenant.name }} · Flat {{ tenant.flatNumber }}
        </p>
      </header>

      <!-- Wide screens: charges, payment and other in one row. -->
      <div class="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <section aria-labelledby="charges-heading" class="rounded-xl border p-4 sm:p-6">
          <h2 id="charges-heading" class="mb-3 font-semibold">Charges</h2>
          <dl class="space-y-2 text-sm" data-testid="charges">
            <div v-for="item in charges" :key="item.label" class="flex justify-between gap-4">
              <dt class="text-muted-foreground">{{ item.label }}</dt>
              <dd class="tabular-nums">{{ item.value }}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="payment-heading" class="rounded-xl border p-4 sm:p-6">
          <h2 id="payment-heading" class="mb-3 font-semibold">Payment</h2>
          <dl class="space-y-2 text-sm" data-testid="payment">
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Total due</dt>
              <dd class="tabular-nums">{{ formatINR(entry.totalDue) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Total paid</dt>
              <dd class="tabular-nums">{{ formatINR(entry.totalPaid) }}</dd>
            </div>
            <div class="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
              <dt>Outstanding</dt>
              <dd class="tabular-nums">{{ formatINR(entry.outstanding) }}</dd>
            </div>
          </dl>

          <p
            v-if="entry.status === 'paid'"
            class="mt-4 flex h-11 items-center justify-center gap-2 rounded-lg bg-success/10 font-medium text-success"
            data-testid="fully-paid"
          >
            <CircleCheck class="size-5" aria-hidden="true" />
            Fully paid
          </p>
          <!-- Payments move to the backend in BE Phase 5. -->
          <p
            v-else
            class="mt-4 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground"
            data-testid="payments-unavailable"
          >
            Payments can't be recorded yet. They're coming in the next update.
          </p>
        </section>

        <section
          aria-labelledby="other-heading"
          class="rounded-xl border p-4 sm:p-6 lg:col-span-2 xl:col-span-1"
        >
          <h2 id="other-heading" class="mb-3 font-semibold">Other</h2>
          <dl class="space-y-3 text-sm" data-testid="other">
            <div>
              <dt class="text-muted-foreground">Notes</dt>
              <!-- Text interpolation, never v-html: notes are user input. -->
              <dd class="mt-1 whitespace-pre-wrap break-words">
                {{ entry.notes.trim() ? entry.notes : 'No notes' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Created</dt>
              <dd class="mt-1">{{ formatTimestamp(entry.createdAt) }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </AppLayout>
</template>
