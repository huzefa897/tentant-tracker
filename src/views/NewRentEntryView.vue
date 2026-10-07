<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBeforeRouteLeave, useRouter, type RouteLocationRaw } from 'vue-router'
import { ArrowLeft, ChevronRight, CircleCheck, User } from '@lucide/vue'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
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
import TenantChipSkeleton from '@/components/tenant/TenantChipSkeleton.vue'
import { Button } from '@/components/ui/button'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { EntrySaveError, SAVE_ERROR_MESSAGE, useRentEntryStore } from '@/stores/rentEntry'
import type { NewRentEntrySubmission, RentEntry } from '@/types/rentEntry'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'

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

const saving = ref(false)
const savedEntry = ref<RentEntry | null>(null)
const saveError = ref<string | null>(null)
// The bill already saved for the month that failed (a duplicate, or a save whose response was
// lost), so the user can open it rather than submit again.
const existingEntry = ref<RentEntry | null>(null)
// The rent and rate the form previewed, to point out when the saved bill used others.
const previewedRent = ref<number | null>(null)
const previewedRate = ref<number | null>(null)
// One per intended bill. Kept after an uncertain failure (no response), so saving again is a
// retry the backend recognises: it returns the bill if the first attempt saved it, and never
// saves a second bill or payment. Replaced after a definite rejection.
let creationKey: string | null = null

// The backend saves the bill (and any payment received with it) and returns it; only then does
// the confirmation appear. On failure the form stays open with its values.
async function handleSave(submission: NewRentEntrySubmission) {
  if (saving.value) return

  saving.value = true
  saveError.value = null
  existingEntry.value = null
  previewedRent.value = submission.entry.rentAmount
  previewedRate.value = submission.entry.electricityRate
  creationKey ??= crypto.randomUUID()

  try {
    savedEntry.value = await rentEntryStore.addEntry(submission, creationKey)
  } catch (error) {
    if (!(error instanceof EntrySaveError && error.uncertain)) creationKey = null
    saveError.value = error instanceof Error ? error.message : SAVE_ERROR_MESSAGE
    existingEntry.value = error instanceof EntrySaveError ? error.existingEntry : null
  } finally {
    saving.value = false
  }
}

// What the backend saved: its charges and figures, which may differ from the preview.
const savedSummary = computed(() => {
  const entry = savedEntry.value
  if (!entry) return null

  return {
    entry,
    month: formatMonthValue(entry.billingMonth),
    rentChanged: previewedRent.value !== null && previewedRent.value !== entry.rentAmount,
    rateChanged: previewedRate.value !== null && previewedRate.value !== entry.electricityRate,
    charges: [
      { label: 'Rent', value: formatINR(entry.rentAmount) },
      {
        label: `Electricity (${entry.electricityUnits} units × ${formatINR(entry.electricityRate)})`,
        value: formatINR(entry.electricityAmount),
      },
      { label: 'Water', value: formatINR(entry.waterAmount) },
    ],
  }
})

// Leaving with unsaved changes (Cancel, or any in-app navigation) asks first.
const isDirty = ref(false)
const discardDialogOpen = ref(false)
let pendingRoute: RouteLocationRaw | null = null
let discardConfirmed = false

onBeforeRouteLeave((to) => {
  // While a save is in flight the page stays: leaving (or discarding) then would still create
  // the bill. Signing out is the exception, since the session has already ended.
  if (saving.value) return Boolean(to.meta.guestOnly)
  if (!isDirty.value || savedEntry.value || discardConfirmed) return true

  pendingRoute = to.fullPath
  discardDialogOpen.value = true
  return false
})

function goToDashboard() {
  router.push({ name: 'dashboard' })
}

function viewEntry(entryId: string) {
  router.push({ name: 'rent-entry-details', params: { tenantId: props.tenantId, entryId } })
}

function discardChanges() {
  discardConfirmed = true
  router.push(pendingRoute ?? { name: 'dashboard' })
}

// The pending route is kept when the dialog closes: Discard closes it before its click
// handler runs, and the leave guard sets a new one each time the dialog opens.
function handleDialogOpenChange(open: boolean) {
  discardDialogOpen.value = open
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <Button
        variant="ghost"
        class="h-11 text-muted-foreground"
        :disabled="saving"
        @click="goToDashboard"
      >
        <ArrowLeft aria-hidden="true" />
        Dashboard
      </Button>
    </template>

    <!-- The form's own shape while the tenant loads, so nothing jumps when it arrives. -->
    <LoadingRegion
      v-if="tenantStatus === 'loading'"
      label="Loading tenant…"
      data-testid="tenant-loading"
    >
      <div class="mb-6">
        <p class="text-3xl font-bold tracking-tight sm:text-4xl">Add Rent Entry</p>
        <p class="mt-2 text-muted-foreground">Record monthly rent and utility charges.</p>
        <TenantChipSkeleton />
      </div>
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="min-w-0 space-y-5">
          <SkeletonLines v-for="section in 3" :key="section" card heading :lines="2" />
        </div>
        <SkeletonLines card heading :lines="5" action class="h-fit" />
      </div>
    </LoadingRegion>

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

        <p
          v-if="savedSummary.rentChanged"
          class="mt-4 w-full rounded-lg bg-secondary px-4 py-3 text-left text-sm text-secondary-foreground"
          data-testid="rent-changed"
        >
          The tenant's rent changed while you were filling in the form. The bill uses the current
          rent, {{ formatINR(savedSummary.entry.rentAmount) }}.
        </p>

        <p
          v-if="savedSummary.rateChanged"
          class="mt-4 w-full rounded-lg bg-secondary px-4 py-3 text-left text-sm text-secondary-foreground"
          data-testid="rate-changed"
        >
          The electricity rate changed while you were filling in the form. The bill uses the current
          rate, {{ formatINR(savedSummary.entry.electricityRate) }} per unit.
        </p>

        <dl
          class="mt-6 w-full space-y-2 rounded-xl border bg-muted/40 p-4 text-left text-sm"
          data-testid="saved-summary"
        >
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Billing month</dt>
            <dd class="font-medium">{{ savedSummary.month }}</dd>
          </div>
          <div
            v-for="item in savedSummary.charges"
            :key="item.label"
            class="flex justify-between gap-4"
          >
            <dt class="text-muted-foreground">{{ item.label }}</dt>
            <dd class="font-medium tabular-nums">{{ item.value }}</dd>
          </div>
          <div class="flex justify-between gap-4 border-t pt-2">
            <dt class="text-muted-foreground">Total due</dt>
            <dd class="font-medium tabular-nums">
              {{ formatINR(savedSummary.entry.totalDue) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Total paid</dt>
            <dd class="font-medium tabular-nums">
              {{ formatINR(savedSummary.entry.totalPaid) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4 border-t pt-2 text-base">
            <dt class="font-semibold">Outstanding</dt>
            <dd class="font-semibold tabular-nums">
              {{ formatINR(savedSummary.entry.outstanding) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-muted-foreground">Status</dt>
            <dd><PaymentStatusBadge :status="savedSummary.entry.status" /></dd>
          </div>
        </dl>

        <Button
          variant="outline"
          class="mt-6 h-12 w-full text-base"
          @click="viewEntry(savedSummary.entry.id)"
        >
          View Entry
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button class="mt-3 h-12 w-full text-base" @click="goToDashboard">
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

        <div
          v-if="existingEntry"
          class="mb-6 flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center"
          data-testid="existing-entry"
        >
          <p class="flex-1 text-sm">
            {{ formatMonthValue(existingEntry.billingMonth) }} already has a saved entry for
            {{ tenant.name }}.
          </p>
          <Button variant="outline" class="h-10 shrink-0" @click="viewEntry(existingEntry.id)">
            Open saved entry
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        <RentEntryForm
          :key="tenant.id"
          :tenant="tenant"
          :save-error="saveError"
          :saving="saving"
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
