import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

import { EntrySaveError, SAVE_ERROR_MESSAGE, useRentEntryStore } from '@/stores/rentEntry'
import { useMeterReadingStore } from '@/stores/meterReading'
import type { NewRentEntrySubmission, RentEntry } from '@/types/rentEntry'
import type { Tenant } from '@/types/tenant'
import { latestReading, unbilledReadings } from '@/utils/meterBilling'

// Saving a bill from Quick entry: the same wiring as the New bill page (the meter the form needs,
// one request per save, a retry the backend recognises after an uncertain failure), for the
// tenant the sheet is on. The sheet shows the form; this keeps what the page would.
export function useQuickBill(tenant: MaybeRefOrGetter<Tenant | null>) {
  const rentEntryStore = useRentEntryStore()
  const meterStore = useMeterReadingStore()

  // A tenant whose meter is set up: the form needs the last billed reading, loaded afresh.
  watch(
    () => {
      const current = toValue(tenant)
      return current?.meterBaseline ? current.id : null
    },
    (tenantId) => {
      if (tenantId) void meterStore.loadMeter(tenantId)
    },
    { immediate: true },
  )
  const meterState = computed(() => {
    const current = toValue(tenant)
    return current ? meterStore.meterFor(current.id) : null
  })
  const meter = computed(() => meterState.value?.meter ?? null)

  const saving = ref(false)
  const saveError = ref<string | null>(null)
  // The bill already saved for the month that failed (a duplicate, or a save whose response was
  // lost), so it can be opened rather than saved again.
  const existingEntry = ref<RentEntry | null>(null)
  // One per intended bill. Kept after an uncertain failure so saving again is a retry; replaced
  // after a definite rejection and when the bill changes (`reset`).
  let creationKey: string | null = null

  // The saved bill, or null when it failed (saveError says why).
  async function save(submission: NewRentEntrySubmission): Promise<RentEntry | null> {
    if (saving.value) return null

    saving.value = true
    saveError.value = null
    existingEntry.value = null
    creationKey ??= crypto.randomUUID()

    try {
      const entry = await rentEntryStore.addEntry(submission, creationKey)
      // Its reading, if any, is the meter's newest, and a meter bill moves the last billed one.
      if (submission.entry.closingReading || submission.entry.closingReadingId) {
        meterStore.forgetMeter(submission.entry.tenantId)
      }
      return entry
    } catch (error) {
      if (!(error instanceof EntrySaveError && error.uncertain)) creationKey = null
      saveError.value = error instanceof Error ? error.message : SAVE_ERROR_MESSAGE
      existingEntry.value = error instanceof EntrySaveError ? error.existingEntry : null
      return null
    } finally {
      saving.value = false
    }
  }

  // A different bill (tenant or month): nothing of the first one carries over.
  function reset() {
    creationKey = null
    saveError.value = null
    existingEntry.value = null
  }

  return {
    saving,
    saveError,
    existingEntry,
    save,
    reset,
    retryMeter() {
      const current = toValue(tenant)
      if (current) void meterStore.loadMeter(current.id)
    },
    lastBilled: computed(() => meter.value?.lastBilled ?? null),
    latestReading: computed(() => (meter.value ? latestReading(meter.value) : null)),
    unbilledReadings: computed(() => (meter.value ? unbilledReadings(meter.value) : [])),
    meterLoading: computed(() => meterState.value?.status === 'loading'),
    meterError: computed(() => meterState.value?.error ?? null),
  }
}
