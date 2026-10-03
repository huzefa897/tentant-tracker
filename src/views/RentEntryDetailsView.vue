<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, User } from '@lucide/vue'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import { Button } from '@/components/ui/button'
import AppLayout from '@/layouts/AppLayout.vue'
import { useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import { formatINR } from '@/utils/currency'
import { formatDateValue, formatMonthValue, formatTimestamp } from '@/utils/date'
import { calculateElectricity, getEntryAmounts } from '@/utils/rentCalculations'

const props = defineProps<{
  tenantId: string
  entryId: string
}>()

const tenantStore = useTenantStore()
const rentEntryStore = useRentEntryStore()
const router = useRouter()

const tenantsReady = ref(tenantStore.tenants.length > 0)
const tenant = computed(() => tenantStore.tenants.find((t) => t.id === props.tenantId) ?? null)

onMounted(async () => {
  rentEntryStore.initialize()

  if (tenantsReady.value) return

  await tenantStore.loadTenants()
  tenantsReady.value = true
})

// Match both ids, so an entry never shows under another tenant's URL.
const entry = computed(
  () =>
    rentEntryStore.entries.find(
      (item) => item.id === props.entryId && item.tenantId === props.tenantId,
    ) ?? null,
)

const amounts = computed(() => (entry.value ? getEntryAmounts(entry.value) : null))

// Rent and rate come from the entry, not the tenant: the tenant's current rates may have changed.
const charges = computed(() => {
  const value = entry.value
  if (!value) return []

  return [
    { label: 'Rent', value: formatINR(value.rentAmount) },
    { label: 'Electricity units', value: String(value.electricityUnits) },
    { label: 'Electricity rate', value: `${formatINR(value.electricityRate)} / unit` },
    {
      label: 'Electricity amount',
      value: formatINR(calculateElectricity(value.electricityUnits, value.electricityRate)),
    },
    { label: 'Water', value: formatINR(value.waterAmount) },
  ]
})

function goToDashboard() {
  router.push({ name: 'dashboard' })
}

// Explicit route, not router.back(): a direct link has no in-app page to go back to.
function goToHistory() {
  router.push({ name: 'rent-entry-history', params: { tenantId: props.tenantId } })
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <Button v-if="tenant" variant="ghost" class="h-11 text-muted-foreground" @click="goToHistory">
        <ArrowLeft aria-hidden="true" />
        Back to Previous Entries
      </Button>
      <Button v-else variant="ghost" class="h-11 text-muted-foreground" @click="goToDashboard">
        <ArrowLeft aria-hidden="true" />
        Back to Dashboard
      </Button>
    </template>

    <p v-if="!tenantsReady" class="text-muted-foreground" role="status">Loading…</p>

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
      v-else-if="rentEntryStore.loadError"
      :message="rentEntryStore.loadError"
      @retry="rentEntryStore.initialize"
    />

    <p v-else-if="!rentEntryStore.initialized" class="text-muted-foreground" role="status">
      Loading entry…
    </p>

    <div
      v-else-if="!entry || !amounts"
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
          <PaymentStatusBadge :status="amounts.status" />
        </div>
        <p
          class="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm text-secondary-foreground"
          data-testid="tenant-chip"
        >
          <User class="size-4" aria-hidden="true" />
          {{ tenant.name }} · Flat {{ tenant.flatNumber }}
        </p>
      </header>

      <div class="grid gap-6 lg:grid-cols-2">
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
              <dd class="tabular-nums">{{ formatINR(amounts.totalDue) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Total paid</dt>
              <dd class="tabular-nums">{{ formatINR(amounts.totalPaid) }}</dd>
            </div>
            <div class="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
              <dt>Outstanding</dt>
              <dd class="tabular-nums">{{ formatINR(amounts.outstanding) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Paid date</dt>
              <dd>{{ entry.paidDate ? formatDateValue(entry.paidDate) : '—' }}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="other-heading" class="rounded-xl border p-4 sm:p-6 lg:col-span-2">
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

    <p v-if="tenantStore.error" class="mt-6 text-sm text-destructive" role="alert">
      {{ tenantStore.error }}
    </p>
  </AppLayout>
</template>
