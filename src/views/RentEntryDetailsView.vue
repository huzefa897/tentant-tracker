<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import { ArrowLeft, CircleCheck, Plus, User } from '@lucide/vue'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import SlowLoadScreen from '@/components/common/SlowLoadScreen.vue'
import PaymentHistory from '@/components/rent/PaymentHistory.vue'
import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import RecordPaymentForm from '@/components/rent/RecordPaymentForm.vue'
import TenantChipSkeleton from '@/components/tenant/TenantChipSkeleton.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAutoRetry } from '@/composables/useAutoRetry'
import { useReceiptDownload } from '@/composables/useReceiptDownload'
import { useRouteEntry } from '@/composables/useRouteEntry'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { PAYMENT_SAVE_ERROR_MESSAGE, PaymentSaveError, useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'
import type { PaymentInput } from '@/types/payment'
import { formatINR } from '@/utils/currency'
import { formatMonthValue, formatTimestamp } from '@/utils/date'

const props = defineProps<{
  tenantId: string
  entryId: string
  // Where the page was opened from, so the back button returns there.
  from?: 'dashboard' | 'history'
}>()

const rentEntryStore = useRentEntryStore()
const tenantStore = useTenantStore()
const router = useRouter()

const {
  tenant,
  status: tenantStatus,
  error: tenantError,
  retryable: tenantRetryable,
} = useRouteTenant(() => props.tenantId)

// Loaded from the backend by its URL, matched on both ids, so it survives a refresh and never
// shows under another tenant.
const {
  entry,
  status: entryStatus,
  error: entryError,
  retryable: entryRetryable,
} = useRouteEntry(
  () => props.tenantId,
  () => props.entryId,
)

// The tenant, then the bill: one skeleton for both, so the page doesn't change shape between
// them. A failed tenant or a missing tenant shows instead.
const pageLoading = computed(
  () =>
    tenantStatus.value === 'loading' ||
    (tenantStatus.value === 'ready' && !!tenant.value && entryStatus.value === 'loading'),
)

// The bill's payments, from the backend, newest first.
const entryPayments = computed(() => rentEntryStore.payments[props.entryId] ?? null)

function loadPayments() {
  rentEntryStore.loadPayments(props.tenantId, props.entryId)
}

useAutoRetry(() => entryPayments.value?.status ?? 'idle', loadPayments)

const paymentDialogOpen = ref(false)
const savingPayment = ref(false)
const paymentError = ref<string | null>(null)
const confirmation = ref<string | null>(null)

function openPaymentDialog() {
  paymentError.value = null
  confirmation.value = null
  paymentDialogOpen.value = true
}

// The dialog stays open while a save is in flight, so its result (and any error) is seen.
function setPaymentDialogOpen(open: boolean) {
  if (!open && savingPayment.value) return
  paymentDialogOpen.value = open
}

// While a payment save is in flight the page stays, on this entry: the save's outcome decides
// whether its key is kept for a retry. Signing out is the exception, since the session has
// already ended (and the store forgets the keys).
onBeforeRouteLeave((to) => !savingPayment.value || Boolean(to.meta.guestOnly))
onBeforeRouteUpdate((to) => !savingPayment.value || Boolean(to.meta.guestOnly))

// The backend records the payment and returns the bill's new balance; only then does the
// confirmation appear. On failure the dialog stays open with the entered values.
async function handleSavePayment(input: PaymentInput) {
  if (savingPayment.value) return

  savingPayment.value = true
  paymentError.value = null
  // One per intended payment, kept by the store after an uncertain failure (no response), even
  // if the dialog is closed or the page left, so the next attempt is a retry the backend
  // recognises and never records the money twice. Replaced after a success or a definite
  // rejection.
  const entryId = input.entryId
  const key = rentEntryStore.paymentKeyFor(entryId)

  try {
    const { payment, replayed } = await rentEntryStore.addPayment(props.tenantId, input, key)
    rentEntryStore.forgetPaymentKey(entryId)
    paymentDialogOpen.value = false
    confirmation.value = replayed
      ? `Payment of ${formatINR(payment.amount)} was already recorded.`
      : `Payment of ${formatINR(payment.amount)} recorded.`
  } catch (error) {
    if (!(error instanceof PaymentSaveError && error.uncertain)) {
      rentEntryStore.forgetPaymentKey(entryId)
    }
    paymentError.value = error instanceof Error ? error.message : PAYMENT_SAVE_ERROR_MESSAGE
  } finally {
    savingPayment.value = false
  }
}

// Every receipt button waits while one is prepared; the error shows above the history.
const {
  downloadingId: downloadingPaymentId,
  error: receiptError,
  downloadPaymentReceipt,
  reset: resetReceiptDownload,
} = useReceiptDownload()

function handleDownloadReceipt(paymentId: string) {
  const payment = entryPayments.value?.payments.find((item) => item.id === paymentId)
  if (payment) void downloadPaymentReceipt(props.tenantId, payment)
}

// The router reuses this page when only the ids in the URL change: nothing from one entry
// should show on another, and its payments load.
watch(
  () => [props.tenantId, props.entryId],
  () => {
    paymentDialogOpen.value = false
    paymentError.value = null
    confirmation.value = null
    resetReceiptDownload()
    loadPayments()
  },
  { immediate: true },
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
        :disabled="savingPayment"
        @click="goToHistory"
      >
        <ArrowLeft aria-hidden="true" />
        Back to Previous Entries
      </Button>
      <Button
        v-else
        variant="ghost"
        class="h-11 text-muted-foreground"
        :disabled="savingPayment"
        @click="backToDashboard"
      >
        <ArrowLeft aria-hidden="true" />
        Back to Dashboard
      </Button>
    </template>

    <!-- The page's own shape while it loads, so nothing jumps when the bill arrives. -->
    <LoadingRegion v-if="pageLoading" label="Loading entry…" data-testid="entry-loading">
      <header class="mb-6">
        <div class="flex flex-wrap items-center gap-3">
          <Skeleton class="h-9 w-56 sm:h-10" />
          <Skeleton class="h-6 w-24 rounded-full" />
        </div>
        <TenantChipSkeleton />
      </header>
      <div class="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <SkeletonLines card heading :lines="5" />
        <SkeletonLines card heading :lines="3" action />
        <div class="rounded-xl border p-4 sm:p-6 lg:col-span-2 xl:order-last xl:col-span-3">
          <Skeleton class="mb-2 h-5 w-36" />
          <SkeletonRows :rows="2" />
        </div>
        <SkeletonLines card heading :lines="2" class="lg:col-span-2 xl:col-span-1" />
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
      <Button class="mt-6 h-11 px-6" @click="goToDashboard">Back to Dashboard</Button>
    </div>

    <SlowLoadScreen
      v-else-if="entryStatus === 'error'"
      :error="entryError"
      :retryable="entryRetryable"
    />

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
        <p
          v-if="confirmation"
          class="mt-4 flex animate-rise-in items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
          role="status"
        >
          <CircleCheck class="size-5 shrink-0" aria-hidden="true" />
          {{ confirmation }}
        </p>
      </header>

      <!-- Wide screens: charges, payment and other in one row, payment history below it. -->
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
          <Button v-else class="mt-4 h-11 w-full" @click="openPaymentDialog">
            <Plus aria-hidden="true" />
            Record Payment
          </Button>
        </section>

        <section
          aria-labelledby="payment-history-heading"
          class="rounded-xl border p-4 sm:p-6 lg:col-span-2 xl:order-last xl:col-span-3"
        >
          <h2 id="payment-history-heading" class="mb-3 font-semibold">Payment history</h2>
          <!-- A failed load must never look like "no payments": keep skeleton while retrying. -->
          <LoadingRegion
            v-if="
              !entryPayments ||
              entryPayments.status === 'loading' ||
              entryPayments.status === 'error'
            "
            label="Loading payments…"
            data-testid="payments-loading"
          >
            <SkeletonRows :rows="2" />
          </LoadingRegion>
          <template v-else>
            <p v-if="receiptError" class="mb-3 text-sm text-destructive" role="alert">
              {{ receiptError }}
            </p>
            <PaymentHistory
              :payments="entryPayments.payments"
              receipts
              :downloading-payment-id="downloadingPaymentId"
              @download-receipt="handleDownloadReceipt"
            />
          </template>
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

      <Dialog :open="paymentDialogOpen" @update:open="setPaymentDialogOpen">
        <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Money received against this bill.</DialogDescription>
          </DialogHeader>
          <RecordPaymentForm
            :tenant="tenant"
            :entry-id="entry.id"
            :billing-month="entry.billingMonth"
            :outstanding="entry.outstanding"
            :saving="savingPayment"
            :save-error="paymentError"
            @save="handleSavePayment"
            @cancel="setPaymentDialogOpen(false)"
          />
        </DialogContent>
      </Dialog>
    </template>
  </AppLayout>
</template>
