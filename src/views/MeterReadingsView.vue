<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Gauge, Plus, User } from '@lucide/vue'
import { useRouter } from 'vue-router'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import MeterReadingForm from '@/components/meter/MeterReadingForm.vue'
import MeterReadingHistory from '@/components/meter/MeterReadingHistory.vue'
import VoidReadingForm from '@/components/meter/VoidReadingForm.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import TenantChipSkeleton from '@/components/tenant/TenantChipSkeleton.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useRouteTenant } from '@/composables/useRouteTenant'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAccessStore } from '@/stores/access'
import {
  type BlockingEntry,
  type BlockingReading,
  MeterReadingError,
  useMeterReadingStore,
} from '@/stores/meterReading'
import type { MeterPoint, MeterReading, MeterReadingInput } from '@/types/meterReading'
import { formatDateValue, formatMonthValue } from '@/utils/date'
import { formatReading } from '@/utils/electricity'

// A tenant's meter: its baseline, the last billed reading, and every reading with its
// consumption. Readings are recorded, corrected and voided here; none of it bills anything.
const props = defineProps<{
  tenantId: string
  // Open Record reading as soon as the meter is shown (from the + Record button).
  record?: boolean
}>()

const router = useRouter()
const accessStore = useAccessStore()
const meterStore = useMeterReadingStore()
const {
  tenant,
  status: tenantStatus,
  error: tenantError,
  retry: retryTenants,
} = useRouteTenant(() => props.tenantId)

watch(
  () => (tenant.value?.meterBaseline ? tenant.value.id : null),
  (tenantId) => {
    if (tenantId) meterStore.loadMeter(tenantId)
  },
  { immediate: true },
)

const state = computed(() => meterStore.meterFor(props.tenantId))
const meter = computed(() => state.value.meter)
const canEdit = computed(() => {
  const role = accessStore.selectedProperty?.role
  return role === 'owner' || role === 'manager'
})

const active = computed(() => meter.value?.readings.filter((r) => r.status === 'active') ?? [])

// The reading a new one follows: the latest active one, else the baseline.
const latest = computed<MeterPoint | null>(() => active.value[0] ?? meter.value?.baseline ?? null)

// The one a corrected reading follows: the active one before it, else the baseline.
function before(reading: MeterReading): MeterPoint | null {
  const earlier = active.value.find((r) => r.id !== reading.id && r.readOn < reading.readOn)
  return earlier ?? meter.value?.baseline ?? null
}

type Dialog = { kind: 'record' } | { kind: 'correct' | 'void'; reading: MeterReading }
const dialog = ref<Dialog | null>(null)
const saving = ref(false)
const saveError = ref<string | null>(null)
const blocking = ref<BlockingEntry[]>([])
const blockingReadings = ref<BlockingReading[]>([])

function open(next: Dialog) {
  saveError.value = null
  blocking.value = []
  blockingReadings.value = []
  dialog.value = next
}

function setOpen(isOpen: boolean) {
  if (!isOpen && !saving.value) dialog.value = null
}

async function run(action: () => Promise<void>) {
  if (saving.value) return
  saving.value = true
  saveError.value = null
  blocking.value = []
  blockingReadings.value = []
  try {
    await action()
    dialog.value = null
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : "Couldn't save the reading."
    if (error instanceof MeterReadingError) {
      blocking.value = error.blockingEntries
      blockingReadings.value = error.blockingReadings
    }
  } finally {
    saving.value = false
  }
}

function handleRecord(input: MeterReadingInput) {
  run(() => meterStore.recordReading(props.tenantId, input))
}

function handleCorrect(input: MeterReadingInput & { reason?: string }) {
  const current = dialog.value
  // A correction is always the reading itself: the form offers no units there.
  if (current?.kind !== 'correct' || input.reading === undefined) return
  const reading = input.reading
  run(() =>
    meterStore.correctReading(props.tenantId, current.reading.id, {
      reading,
      readOn: input.readOn,
      notes: input.notes,
      reason: input.reason ?? '',
    }),
  )
}

function handleVoid(reason: string) {
  const current = dialog.value
  if (current?.kind !== 'void') return
  run(() => meterStore.voidReading(props.tenantId, current.reading.id, reason))
}

// Once, when the meter first shows and the user may record.
let recordOpened = false
watch(
  () => !!meter.value && canEdit.value,
  (ready) => {
    if (!ready || !props.record || recordOpened) return
    recordOpened = true
    open({ kind: 'record' })
  },
  { immediate: true },
)

function openBill(entryId: string) {
  router.push({ name: 'rent-entry-details', params: { tenantId: props.tenantId, entryId } })
}

function goToTenants() {
  router.push({ name: 'tenants' })
}

const pageLoading = computed(
  () =>
    tenantStatus.value === 'loading' ||
    (!!tenant.value?.meterBaseline && state.value.status !== 'error' && !meter.value),
)
</script>

<template>
  <AppLayout>
    <LoadingRegion v-if="pageLoading" label="Loading meter readings…" data-testid="meter-loading">
      <header class="mb-6">
        <Skeleton class="h-9 w-64 sm:h-10" />
        <TenantChipSkeleton />
      </header>
      <div class="max-w-2xl space-y-6">
        <SkeletonLines card :lines="2" />
        <SkeletonRows :rows="4" />
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
        This tenant doesn't exist or has been removed. Choose one from Tenants.
      </p>
      <Button class="mt-6 h-11 px-6" @click="goToTenants">Go to tenants</Button>
    </div>

    <template v-else>
      <header class="mb-6">
        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Meter readings</h1>
        <p
          class="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm text-secondary-foreground"
          data-testid="tenant-chip"
        >
          <User class="size-4" aria-hidden="true" />
          {{ tenant.name }} · Flat {{ tenant.flatNumber }}
        </p>
      </header>

      <div class="max-w-2xl space-y-6">
        <p
          v-if="!tenant.meterBaseline"
          class="rounded-xl border border-dashed p-6 text-sm text-muted-foreground"
          role="status"
          data-testid="meter-not-set-up"
        >
          This tenant's meter isn't set up. An owner sets its starting reading in admin; until then,
          bills take electricity units typed in.
        </p>

        <RentEntriesLoadError
          v-else-if="state.status === 'error'"
          :message="state.error ?? ''"
          @retry="meterStore.loadMeter(tenant.id)"
        />

        <template v-else-if="meter">
          <section class="rounded-xl border bg-card p-4 sm:p-6" aria-labelledby="meter-summary">
            <h2 id="meter-summary" class="sr-only">Meter</h2>
            <dl class="grid grid-cols-2 gap-x-6 gap-y-4" data-testid="meter-summary">
              <div v-if="meter.baseline">
                <dt class="text-sm text-muted-foreground">Starting reading</dt>
                <dd class="mt-0.5 font-semibold tabular-nums">
                  {{ formatReading(meter.baseline.reading) }}
                  <span class="block text-xs font-normal text-muted-foreground">
                    {{ formatDateValue(meter.baseline.readOn) }}
                  </span>
                </dd>
              </div>
              <div v-if="meter.lastBilled">
                <dt class="text-sm text-muted-foreground">Billed up to</dt>
                <dd class="mt-0.5 font-semibold tabular-nums">
                  {{ formatReading(meter.lastBilled.reading) }}
                  <span class="block text-xs font-normal text-muted-foreground">
                    {{ formatDateValue(meter.lastBilled.readOn) }}
                  </span>
                </dd>
              </div>
            </dl>
            <Button v-if="canEdit" class="mt-5 h-11 px-6" @click="open({ kind: 'record' })">
              <Plus aria-hidden="true" />
              Record reading
            </Button>
          </section>

          <section aria-labelledby="meter-history">
            <h2 id="meter-history" class="mb-3 flex items-center gap-2 font-semibold">
              <Gauge class="size-4" aria-hidden="true" />
              Readings
            </h2>
            <MeterReadingHistory
              :readings="meter.readings"
              :can-edit="canEdit"
              @correct="open({ kind: 'correct', reading: $event })"
              @void="open({ kind: 'void', reading: $event })"
            />
          </section>
        </template>
      </div>

      <Dialog :open="dialog !== null" @update:open="setOpen">
        <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {{
                dialog?.kind === 'void'
                  ? 'Void reading'
                  : dialog?.kind === 'correct'
                    ? 'Correct reading'
                    : 'Record reading'
              }}
            </DialogTitle>
            <DialogDescription>
              {{
                dialog?.kind === 'record'
                  ? 'Recording a reading bills nothing: the next bill with electricity can close on it.'
                  : 'The original stays in the list, marked void.'
              }}
            </DialogDescription>
          </DialogHeader>

          <div
            v-if="blocking.length"
            class="rounded-lg bg-warning/10 p-3 text-sm"
            data-testid="blocking-bills"
          >
            <p>Void these bills first, in this order (newest first):</p>
            <ul class="mt-2 space-y-1">
              <li v-for="bill in blocking" :key="bill.id">
                <button
                  type="button"
                  class="font-medium text-primary underline-offset-4 hover:underline"
                  @click="openBill(bill.id)"
                >
                  {{ formatMonthValue(bill.billingMonth) }} bill
                </button>
              </li>
            </ul>
          </div>

          <div
            v-if="blockingReadings.length"
            class="rounded-lg bg-warning/10 p-3 text-sm"
            data-testid="blocking-readings"
          >
            <p>Void these readings first, in this order (newest first):</p>
            <ul class="mt-2 space-y-1">
              <li v-for="item in blockingReadings" :key="item.id" class="font-medium">
                {{ formatReading(Number(item.reading)) }} on {{ formatDateValue(item.readOn) }}
              </li>
            </ul>
          </div>

          <VoidReadingForm
            v-if="dialog?.kind === 'void'"
            :key="dialog.reading.id"
            :reading="dialog.reading"
            :saving="saving"
            :save-error="saveError"
            @void="handleVoid"
            @cancel="setOpen(false)"
          />
          <MeterReadingForm
            v-else-if="dialog?.kind === 'correct'"
            :key="dialog.reading.id"
            :after="before(dialog.reading)"
            :correcting="dialog.reading"
            :saving="saving"
            :save-error="saveError"
            @submit="handleCorrect"
            @cancel="setOpen(false)"
          />
          <MeterReadingForm
            v-else-if="dialog?.kind === 'record'"
            :after="latest"
            :saving="saving"
            :save-error="saveError"
            @submit="handleRecord"
            @cancel="setOpen(false)"
          />
        </DialogContent>
      </Dialog>
    </template>
  </AppLayout>
</template>
