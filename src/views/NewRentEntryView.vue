<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRouter, type RouteLocationRaw } from 'vue-router'
import { ArrowLeft, CircleCheck, FileText, User } from '@lucide/vue'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import RentEntryForm from '@/components/rent/RentEntryForm.vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { useRentEntryStore } from '@/stores/rentEntry'
import type { NewRentEntrySubmission, RentEntry } from '@/types/rentEntry'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'
import { getEntryAmounts } from '@/utils/rentCalculations'

// From the route (`props: true`), so the entry always belongs to the tenant in the URL.
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

// Needed for the duplicate check, even when this URL is opened directly.
onMounted(() => rentEntryStore.initialize())

const savedEntry = ref<RentEntry | null>(null)
const saveError = ref<string | null>(null)

// The store writes the bill and any initial payment to storage together first, so the
// confirmation only appears once both are saved. On failure the form stays open with its values.
function handleSave(submission: NewRentEntrySubmission) {
  saveError.value = null

  try {
    savedEntry.value = rentEntryStore.addEntry(submission)
  } catch (error) {
    saveError.value =
      error instanceof Error ? error.message : 'Unable to save the entry. Please try again.'
  }
}

function retryLoad() {
  saveError.value = null
  rentEntryStore.initialize()
}

const savedSummary = computed(() => {
  const entry = savedEntry.value
  if (!entry) return null

  return {
    month: formatMonthValue(entry.billingMonth),
    ...getEntryAmounts(entry, rentEntryStore.getTotalPaid(entry.id)),
  }
})

// The payment saved with the bill, if any: the one a receipt can be issued for.
const initialPayment = computed(() =>
  savedEntry.value ? (rentEntryStore.getPaymentsForEntry(savedEntry.value.id)[0] ?? null) : null,
)

const receiptError = ref<string | null>(null)

// Issues (or reuses) the receipt, then opens it, where Print / Save as PDF lives. A failure
// shows here; the entry and payment are already saved.
function openReceipt() {
  const payment = initialPayment.value
  const entry = savedEntry.value
  if (!payment || !entry) return

  receiptError.value = null

  try {
    const receipt = rentEntryStore.issueReceipt(payment.id)
    router.push({
      name: 'payment-receipt',
      params: { tenantId: entry.tenantId, entryId: entry.id, receiptId: receipt.id },
    })
  } catch (error) {
    receiptError.value =
      error instanceof Error ? error.message : 'Unable to issue the receipt. Please try again.'
  }
}

// Leaving with unsaved changes (Cancel, or any in-app navigation) asks first.
const isDirty = ref(false)
const discardDialogOpen = ref(false)
let pendingRoute: RouteLocationRaw | null = null
let discardConfirmed = false

onBeforeRouteLeave((to) => {
  if (!isDirty.value || savedEntry.value || discardConfirmed) return true

  pendingRoute = to.fullPath
  discardDialogOpen.value = true
  return false
})

function goToDashboard() {
  router.push({ name: 'dashboard' })
}

function discardChanges() {
  discardConfirmed = true
  router.push(pendingRoute ?? { name: 'dashboard' })
}

function handleDialogOpenChange(open: boolean) {
  discardDialogOpen.value = open
  if (!open) pendingRoute = null
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <Button variant="ghost" class="h-11 text-muted-foreground" @click="goToDashboard">
        <ArrowLeft aria-hidden="true" />
        Dashboard
      </Button>
    </template>

    <p v-if="tenantStatus === 'loading'" class="text-muted-foreground" role="status">Loading…</p>

    <RentEntriesLoadError
      v-else-if="tenantStatus === 'error'"
      :message="tenantError ?? ''"
      @retry="retryTenants"
    />

    <template v-else-if="!tenant">
      <div
        class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
        role="alert"
      >
        <h1 class="text-lg font-semibold">Tenant not found</h1>
        <p class="mt-1 max-w-sm text-sm text-muted-foreground">
          This tenant doesn't exist or has been removed. Choose a tenant from the dashboard.
        </p>
        <Button class="mt-6 h-11 px-6" @click="goToDashboard">Back to Dashboard</Button>
      </div>
    </template>

    <template v-else>
      <section
        v-if="savedSummary"
        class="mx-auto flex max-w-md flex-col items-center text-center"
        aria-labelledby="entry-saved-heading"
      >
        <div
          class="mb-4 flex size-16 items-center justify-center rounded-full bg-success/10 text-success"
          aria-hidden="true"
        >
          <CircleCheck class="size-9" />
        </div>
        <h1 id="entry-saved-heading" class="text-2xl font-bold tracking-tight sm:text-3xl">
          Entry saved
        </h1>
        <p class="mt-2 text-muted-foreground">
          {{ savedSummary.month }} for {{ tenant.name }}, Flat {{ tenant.flatNumber }}, has been
          recorded.
        </p>

        <dl class="mt-6 w-full space-y-2 rounded-xl border bg-muted/40 p-4 text-left text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Billing month</dt>
            <dd class="font-medium">{{ savedSummary.month }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Total due</dt>
            <dd class="font-medium tabular-nums">{{ formatINR(savedSummary.totalDue) }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Total paid</dt>
            <dd class="font-medium tabular-nums">{{ formatINR(savedSummary.totalPaid) }}</dd>
          </div>
          <div class="flex justify-between gap-4 border-t pt-2 text-base">
            <dt class="font-semibold">Outstanding</dt>
            <dd class="font-semibold tabular-nums">{{ formatINR(savedSummary.outstanding) }}</dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-muted-foreground">Status</dt>
            <dd><PaymentStatusBadge :status="savedSummary.status" /></dd>
          </div>
        </dl>

        <p
          v-if="receiptError"
          class="mt-6 w-full rounded-lg bg-destructive/10 px-4 py-3 text-left text-sm text-destructive"
          role="alert"
          data-testid="receipt-error"
        >
          {{ receiptError }}
        </p>

        <Button
          v-if="initialPayment"
          variant="outline"
          class="mt-6 h-12 w-full text-base"
          @click="openReceipt"
        >
          <FileText aria-hidden="true" />
          Receipt (PDF)
        </Button>

        <Button
          class="h-12 w-full text-base"
          :class="initialPayment ? 'mt-3' : 'mt-6'"
          @click="goToDashboard"
        >
          Back to Dashboard
        </Button>
      </section>

      <template v-else>
        <header class="mb-6">
          <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Add Rent Entry</h1>
          <p class="mt-2 text-muted-foreground">Record monthly rent and utility charges.</p>
          <p
            class="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm text-secondary-foreground"
            data-testid="tenant-chip"
          >
            <User class="size-4" aria-hidden="true" />
            {{ tenant.name }} · Flat {{ tenant.flatNumber }}
          </p>
        </header>

        <RentEntriesLoadError
          v-if="rentEntryStore.loadError"
          class="mb-6"
          :message="rentEntryStore.loadError"
          @retry="retryLoad"
        />

        <RentEntryForm
          :key="tenant.id"
          :tenant="tenant"
          :save-error="saveError"
          @save="handleSave"
          @cancel="goToDashboard"
          @dirty-change="isDirty = $event"
        />
      </template>
    </template>

    <AlertDialog :open="discardDialogOpen" @update:open="handleDialogOpenChange">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this entry?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes. If you leave now, they will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="discardChanges">
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppLayout>
</template>
