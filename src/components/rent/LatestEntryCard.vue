<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from '@lucide/vue'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import { Button } from '@/components/ui/button'
import type { RentEntry } from '@/types/rentEntry'
import { formatINR } from '@/utils/currency'
import { formatDateValue, formatMonthValue } from '@/utils/date'
import { calculateElectricity, getEntryAmounts } from '@/utils/rentCalculations'

// A tenant's most recent bill in full, for the dashboard. The page picks the bill and sums its
// payments, so the figures match Previous Entries and the summary page.
const props = defineProps<{
  entry: RentEntry
  totalPaid: number
  // The bill's most recent payment date; null when nothing has been paid.
  lastPaidDate: string | null
}>()

const emit = defineEmits<{
  view: [entryId: string]
}>()

const month = computed(() => formatMonthValue(props.entry.billingMonth))
const amounts = computed(() => getEntryAmounts(props.entry, props.totalPaid))

// Rent and rate come from the entry: the tenant's current rates may have changed since.
const charges = computed(() => [
  { label: 'Rent', value: formatINR(props.entry.rentAmount) },
  {
    label: 'Electricity',
    value: formatINR(
      calculateElectricity(props.entry.electricityUnits, props.entry.electricityRate),
    ),
    details: `${props.entry.electricityUnits} units × ${formatINR(props.entry.electricityRate)}`,
  },
  { label: 'Water', value: formatINR(props.entry.waterAmount) },
])
</script>

<template>
  <section aria-labelledby="latest-entry-heading" class="rounded-xl border bg-card p-4 sm:p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs text-muted-foreground">Latest entry</p>
        <div class="mt-0.5 flex flex-wrap items-center gap-2">
          <h3 id="latest-entry-heading" class="text-lg font-semibold">{{ month }}</h3>
          <PaymentStatusBadge :status="amounts.status" />
        </div>
      </div>
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
          <dd class="tabular-nums">{{ formatINR(amounts.totalDue) }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">
            Total paid
            <span v-if="lastPaidDate" class="text-xs"
              >(last {{ formatDateValue(lastPaidDate) }})</span
            >
          </dt>
          <dd class="tabular-nums">{{ formatINR(amounts.totalPaid) }}</dd>
        </div>
        <div class="flex justify-between gap-4 font-semibold">
          <dt>Outstanding</dt>
          <dd class="tabular-nums">{{ formatINR(amounts.outstanding) }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
