<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import { ArrowLeft, User } from '@lucide/vue'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import EntryCorrectionForm from '@/components/rent/EntryCorrectionForm.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import TenantChipSkeleton from '@/components/tenant/TenantChipSkeleton.vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouteEntry } from '@/composables/useRouteEntry'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import {
  CORRECTION_ERROR_MESSAGE,
  EntryCorrectionError,
  useRentEntryStore,
} from '@/stores/rentEntry'
import type { EntryCorrectionInput } from '@/types/rentEntry'
import { formatMonthValue } from '@/utils/date'

// Corrects a bill's charges (owners only): voids it and creates its replacement for the same
// month, together. On success it opens the replacement, which links back to the original.
const props = defineProps<{
  tenantId: string
  entryId: string
}>()

const rentEntryStore = useRentEntryStore()
const accessStore = useAccessStore()
const router = useRouter()

const {
  tenant,
  status: tenantStatus,
  error: tenantError,
  retry: retryTenants,
} = useRouteTenant(() => props.tenantId)

const {
  entry,
  status: entryStatus,
  error: entryError,
  retry: retryEntry,
} = useRouteEntry(
  () => props.tenantId,
  () => props.entryId,
)

const entryPayments = computed(() => rentEntryStore.payments[props.entryId] ?? null)
// Reversed payments don't count; these must be reversed before the bill is corrected.
const paymentsToReverse = computed(
  () => entryPayments.value?.payments.filter((payment) => payment.status === 'recorded') ?? [],
)

function loadPayments() {
  rentEntryStore.loadPayments(props.tenantId, props.entryId)
}

// Always from the backend: the payments decide whether the bill can be corrected, and a list
// loaded earlier may predate one.
// Once they've loaded, a reload (e.g. after a failed correction) keeps the form and what's been
// typed in it on screen.
const paymentsShown = ref(false)
watch(
  () => [props.tenantId, props.entryId],
  () => {
    paymentsShown.value = false
    loadPayments()
  },
  { immediate: true },
)
watch(
  () => entryPayments.value?.status,
  (status) => {
    if (status === 'ready' || status === 'error') paymentsShown.value = true
  },
  { immediate: true },
)

const isOwner = computed(() => accessStore.selectedProperty?.role === 'owner')

const pageLoading = computed(
  () =>
    tenantStatus.value === 'loading' ||
    (tenantStatus.value === 'ready' &&
      !!tenant.value &&
      (entryStatus.value === 'loading' || (!!entry.value && !paymentsShown.value))),
)

const saving = ref(false)
const saveError = ref<string | null>(null)

// While a correction is in flight the page stays: its outcome decides whether the key is kept
// for a retry. Signing out is the exception (the store forgets the keys).
onBeforeRouteLeave((to) => !saving.value || Boolean(to.meta.guestOnly))
onBeforeRouteUpdate((to) => !saving.value || Boolean(to.meta.guestOnly))

// Only once the backend confirms does the replacement open. On failure the form keeps the
// changes, and after an uncertain one (no response) the same key is kept, so submitting again
// returns the correction if the first attempt made it.
async function handleSubmit(input: EntryCorrectionInput) {
  const original = entry.value
  if (!original || saving.value) return

  saving.value = true
  saveError.value = null
  const key = rentEntryStore.correctionKeyFor(original.id)
  try {
    const { replacement } = await rentEntryStore.correctEntry(props.tenantId, original, input, key)
    rentEntryStore.forgetCorrectionKey(original.id)
    saving.value = false
    await router.push({
      name: 'rent-entry-details',
      params: { tenantId: props.tenantId, entryId: replacement.id },
      query: { corrected: '1' },
    })
  } catch (error) {
    if (!(error instanceof EntryCorrectionError && error.uncertain)) {
      rentEntryStore.forgetCorrectionKey(original.id)
    }
    saveError.value = error instanceof Error ? error.message : CORRECTION_ERROR_MESSAGE
  } finally {
    saving.value = false
  }
}

function openReplacement(entryId: string) {
  router.push({ name: 'rent-entry-details', params: { tenantId: props.tenantId, entryId } })
}

function backToEntry() {
  router.push({
    name: 'rent-entry-details',
    params: { tenantId: props.tenantId, entryId: props.entryId },
  })
}

function goToDashboard() {
  router.push({ name: 'dashboard' })
}
</script>

<template>
  <AppLayout>
    <template #back>
      <Button
        variant="ghost"
        class="-ml-3 h-11 text-primary hover:text-primary"
        :disabled="saving"
        @click="backToEntry"
      >
        <ArrowLeft aria-hidden="true" />
        Back to the bill
      </Button>
    </template>

    <LoadingRegion v-if="pageLoading" label="Loading entry…" data-testid="correction-loading">
      <header class="mb-6">
        <Skeleton class="h-9 w-64 sm:h-10" />
        <TenantChipSkeleton />
      </header>
      <div class="max-w-2xl space-y-6">
        <SkeletonLines card heading :lines="4" />
        <SkeletonLines card heading :lines="1" />
      </div>
    </LoadingRegion>

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
      <Button class="mt-6 h-11 px-6" @click="goToDashboard">Back to dashboard</Button>
    </div>

    <RentEntriesLoadError
      v-else-if="entryStatus === 'error'"
      :message="entryError ?? ''"
      @retry="retryEntry"
    />

    <div
      v-else-if="!entry"
      class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
      role="alert"
    >
      <h1 class="text-lg font-semibold">Bill not found</h1>
      <p class="mt-1 max-w-sm text-sm text-muted-foreground">
        This bill doesn't exist for {{ tenant.name }}, Flat {{ tenant.flatNumber }}.
      </p>
    </div>

    <template v-else>
      <header class="mb-6">
        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">
          Correct {{ formatMonthValue(entry.billingMonth) }} bill
        </h1>
        <p
          class="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm text-secondary-foreground"
          data-testid="tenant-chip"
        >
          <User class="size-4" aria-hidden="true" />
          {{ tenant.name }} · Flat {{ tenant.flatNumber }}
        </p>
      </header>

      <div class="max-w-2xl">
        <!-- Nothing to correct: say why rather than show a form the backend would refuse. -->
        <p
          v-if="!isOwner"
          class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
          role="alert"
        >
          Only the property's owners can correct bills.
        </p>
        <!-- Corrected already, e.g. by an attempt whose response was lost: open its result. -->
        <div
          v-else-if="entry.replacedByEntryId"
          class="rounded-lg border border-dashed p-4 text-sm"
          role="alert"
        >
          <p class="text-muted-foreground">This bill has already been corrected.</p>
          <Button class="mt-3 h-11" @click="openReplacement(entry.replacedByEntryId)">
            Open the replacement
          </Button>
        </div>
        <p
          v-else-if="entry.billStatus === 'void'"
          class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
          role="alert"
        >
          This bill is void, so it can't be corrected.
        </p>
        <RentEntriesLoadError
          v-else-if="entryPayments?.status === 'error'"
          :message="entryPayments.error ?? ''"
          @retry="loadPayments"
        />
        <EntryCorrectionForm
          v-else
          :key="entry.id"
          :original="entry"
          :payments-to-reverse="paymentsToReverse"
          :saving="saving"
          :save-error="saveError"
          @submit="handleSubmit"
          @cancel="backToEntry"
        />
      </div>
    </template>
  </AppLayout>
</template>
