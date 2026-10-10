<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, Download } from '@lucide/vue'

import EntryStatusBadge from '@/components/rent/EntryStatusBadge.vue'
import { Button } from '@/components/ui/button'
import type { RentEntry } from '@/types/rentEntry'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'

// A tenant's most recent bill in full, for the dashboard, with the figures the backend
// calculated, so they match Previous Entries and the summary page.
const props = defineProps<{
  entry: RentEntry
  // While its receipt is being prepared: the button waits.
  downloadingReceipt?: boolean
}>()

const emit = defineEmits<{
  view: [entryId: string]
  // The receipt for the bill's most recent payment (offered once anything is paid).
  'download-receipt': [entryId: string]
}>()

const month = computed(() => formatMonthValue(props.entry.billingMonth))

// Rent and rate come from the entry: the tenant's current rates may have changed since.
const charges = computed(() => [
  { label: 'Rent', value: formatINR(props.entry.rentAmount) },
  {
    label: 'Electricity',
    value: formatINR(props.entry.electricityAmount),
    details: `${props.entry.electricityUnits} units × ${formatINR(props.entry.electricityRate)}`,
  },
  { label: 'Water', value: formatINR(props.entry.waterAmount) },
])
</script>

<template>
  <section
    aria-labelledby="latest-entry-heading"
    class="animate-rise-in rounded-xl border bg-card p-4 sm:p-5"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs text-muted-foreground">Latest entry</p>
        <div class="mt-0.5 flex flex-wrap items-center gap-2">
          <h3 id="latest-entry-heading" class="text-lg font-semibold">{{ month }}</h3>
          <EntryStatusBadge :entry="entry" />
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          v-if="entry.totalPaid > 0"
          variant="outline"
          class="h-10"
          :disabled="downloadingReceipt"
          :aria-label="`Download the latest receipt for ${month}`"
          data-testid="download-entry-receipt"
          @click="emit('download-receipt', entry.id)"
        >
          <Download aria-hidden="true" />
          {{ downloadingReceipt ? 'Preparing…' : 'Download receipt' }}
        </Button>
        <Button
          variant="outline"
          class="h-10"
          :aria-label="`View summary for ${month}`"
          @click="emit('view', entry.id)"
        >
          View Summary
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div class="mt-4 grid gap-4 text-sm sm:grid-cols-2">
      <dl class="space-y-1.5" data-testid="latest-entry-charges">
        <div v-for="item in charges" :key="item.label" class="flex justify-between gap-4">
          <dt class="text-muted-foreground">
            {{ item.label }}
            <span v-if="item.details" class="text-xs">({{ item.details }})</span>
          </dt>
          <dd class="tabular-nums">{{ item.value }}</dd>
        </div>
      </dl>

      <dl
        class="space-y-1.5 border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4"
        data-testid="latest-entry-amounts"
      >
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">Total due</dt>
          <dd class="tabular-nums">{{ formatINR(entry.totalDue) }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">Total paid</dt>
          <dd class="tabular-nums">{{ formatINR(entry.totalPaid) }}</dd>
        </div>
        <div class="flex justify-between gap-4 font-semibold">
          <dt>Outstanding</dt>
          <dd class="tabular-nums">{{ formatINR(entry.outstanding) }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
