<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, CircleCheck, Plus, User } from '@lucide/vue'

import PaymentHistory from '@/components/rent/PaymentHistory.vue'
import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import RecordPaymentForm from '@/components/rent/RecordPaymentForm.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { useRentEntryStore } from '@/stores/rentEntry'
import { formatINR } from '@/utils/currency'
import type { PaymentInput } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import { formatMonthValue, formatTimestamp } from '@/utils/date'
import {
  calculateElectricity,
  getEntryAmounts,
  sortPaymentsNewestFirst,
} from '@/utils/rentCalculations'

const props = defineProps<{
  tenantId: string
  entryId: string
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

// Match both ids, so an entry never shows under another tenant's URL.
const entry = computed(
  () =>
    rentEntryStore.entries.find(
      (item) => item.id === props.entryId && item.tenantId === props.tenantId,
    ) ?? null,
)

// Paid and outstanding come from the entry's payment records.
const amounts = computed(() =>
  entry.value ? getEntryAmounts(entry.value, rentEntryStore.getTotalPaid(entry.value.id)) : null,
)

const payments = computed(() =>
  entry.value ? sortPaymentsNewestFirst(rentEntryStore.getPaymentsForEntry(entry.value.id)) : [],
)

const paymentDialogOpen = ref(false)
const savingPayment = ref(false)
const paymentError = ref<string | null>(null)
const confirmation = ref<string | null>(null)

function openPaymentDialog() {
  paymentError.value = null
  confirmation.value = null
  paymentDialogOpen.value = true
}

// The store re-checks the outstanding balance and writes before updating state, so the
// confirmation only appears once the payment is saved. On failure the dialog stays open with
// the entered values.
function handleSavePayment({ id, input }: { id: string; input: PaymentInput }) {
  if (savingPayment.value) return

  savingPayment.value = true
  paymentError.value = null

  try {
    const payment = rentEntryStore.addPayment(input, id)
    paymentDialogOpen.value = false
    confirmation.value = `Payment of ${formatINR(payment.amount)} recorded.`
  } catch (error) {
    paymentError.value =
      error instanceof Error ? error.message : 'Unable to save the payment. Please try again.'
  } finally {
    savingPayment.value = false
  }
}

const issuingReceipt = ref(false)
const receiptError = ref<string | null>(null)

function goToReceipt(receipt: PaymentReceipt) {
  router.push({
    name: 'payment-receipt',
    params: { tenantId: props.tenantId, entryId: props.entryId, receiptId: receipt.id },
  })
}

// Saved before navigating, so the receipt page always opens a stored receipt. A failure shows
// here and leaves the payment as it was: it's already recorded.
function handleIssueReceipt(paymentId: string) {
  if (issuingReceipt.value) return

  issuingReceipt.value = true
  receiptError.value = null

  try {
    goToReceipt(rentEntryStore.issueReceipt(paymentId))
  } catch (error) {
    receiptError.value =
      error instanceof Error ? error.message : 'Unable to issue the receipt. Please try again.'
  } finally {
    issuingReceipt.value = false
  }
}

// The router reuses this page when only the ids in the URL change: nothing from one entry
// should show on another.
watch(
  () => [props.tenantId, props.entryId],
  () => {
    paymentDialogOpen.value = false
    paymentError.value = null
    confirmation.value = null
    receiptError.value = null
  },
)

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
        <p
          v-if="confirmation"
          class="mt-4 flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
          role="status"
        >
          <CircleCheck class="size-5 shrink-0" aria-hidden="true" />
          {{ confirmation }}
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
          </dl>

          <p
            v-if="amounts.status === 'paid'"
            class="mt-4 flex h-11 items-center justify-center gap-2 rounded-lg bg-success/10 font-medium text-success"
            data-testid="fully-paid"
          >
            <CircleCheck class="size-5" aria-hidden="true" />
            Fully paid
          </p>
          <Button v-else class="mt-4 h-11 w-full" @click="openPaymentDialog">
            <Plus aria-hidden="true" />
            Record Payment
          </Button>
        </section>

        <section
          aria-labelledby="payment-history-heading"
          class="rounded-xl border p-4 sm:p-6 lg:col-span-2"
        >
          <h2 id="payment-history-heading" class="mb-3 font-semibold">Payment history</h2>
          <p
            v-if="receiptError"
            class="mb-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
            data-testid="receipt-error"
          >
            {{ receiptError }}
          </p>
          <PaymentHistory
            :payments="payments"
            :receipts="rentEntryStore.receipts"
            :issuing="issuingReceipt"
            @issue-receipt="handleIssueReceipt"
            @view-receipt="goToReceipt"
          />
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

      <Dialog v-model:open="paymentDialogOpen">
        <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Money received against this bill.</DialogDescription>
          </DialogHeader>
          <RecordPaymentForm
            :tenant="tenant"
            :entry-id="entry.id"
            :billing-month="entry.billingMonth"
            :outstanding="amounts.outstanding"
            :saving="savingPayment"
            :save-error="paymentError"
            @save="handleSavePayment"
            @cancel="paymentDialogOpen = false"
          />
        </DialogContent>
      </Dialog>
    </template>
  </AppLayout>
</template>
