<script setup lang="ts">
import { computed } from 'vue'

import { Button } from '@/components/ui/button'
import type { DashboardSummary } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatMonthCount, formatTenantCount } from '@/utils/rentalPeriods'

// The property's rent due as one strip of three: rental months overdue (and how long the oldest
// has waited), months whose bill isn't prepared (with a shortcut to them), and the outstanding
// amount known from prepared bills. When and how much each tab holds is on the tabs below.
// Counts of months are never called tenants. A month awaiting its bill is counted, never added
// to an amount: with no prepared bills the amount is "not known yet", never ₹0. Only overdue
// months take colour.
const props = defineProps<{
  summary: DashboardSummary
}>()

const emit = defineEmits<{
  // Show the months whose bill isn't prepared.
  showUnbilled: []
}>()

const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`

const overdue = computed(() => {
  const s = props.summary
  if (s.overduePeriodCount === 0) return { value: null, text: 'Nothing overdue', note: null }
  return {
    value: s.overduePeriodCount,
    text: `${s.overduePeriodCount === 1 ? 'month' : 'months'} overdue`,
    note: [
      `Oldest ${days(s.oldestOverdueDays ?? 0)}`,
      s.knownOverdue > 0 ? `${formatINR(s.knownOverdue)} outstanding` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }
})

const unbilled = computed(() => {
  const s = props.summary
  if (s.awaitingBillPeriodCount === 0) {
    return { value: null, text: 'Every bill prepared', note: null }
  }
  return {
    value: s.awaitingBillPeriodCount,
    text: s.awaitingBillPeriodCount === 1 ? 'bill not prepared' : 'bills not prepared',
    note:
      s.overdueAwaitingBillPeriodCount > 0
        ? `${s.overdueAwaitingBillPeriodCount} of them overdue`
        : null,
  }
})

// The amount is only ever what prepared bills say; months awaiting a bill are named, not added.
const outstanding = computed(() => {
  const s = props.summary
  const awaiting = s.awaitingBillPeriodCount
  if (s.owedPeriodCount === 0) return { value: null, text: 'Nothing owed', note: null }
  if (s.knownOutstanding === 0) {
    return {
      value: null,
      text: 'No amount yet',
      note: `${formatMonthCount(awaiting)} awaiting a bill`,
    }
  }
  return {
    value: formatINR(s.knownOutstanding),
    text: 'outstanding',
    note: [
      formatTenantCount(s.owingTenancyCount),
      awaiting > 0
        ? `not counting ${formatMonthCount(awaiting)} awaiting a bill`
        : 'from prepared bills',
    ].join(' · '),
  }
})

const segments = computed(() => [
  { id: 'overdue', term: 'Overdue', ...overdue.value },
  { id: 'unbilled', term: 'Bills', ...unbilled.value },
  { id: 'total', term: 'Outstanding', ...outstanding.value },
])
</script>

<template>
  <section aria-labelledby="summary-heading" data-testid="dashboard-summary">
    <h2 id="summary-heading" class="sr-only">Summary</h2>
    <dl
      class="grid divide-y overflow-hidden rounded-xl border bg-card lg:grid-cols-[1fr_1.25fr_1fr] lg:divide-x lg:divide-y-0"
    >
      <div
        v-for="segment in segments"
        :key="segment.id"
        class="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5"
        :class="{ 'bg-destructive/5': segment.id === 'overdue' && segment.value !== null }"
        :data-testid="`summary-${segment.id}`"
      >
        <dt class="sr-only">{{ segment.term }}</dt>
        <!-- The spaces are in the text, so it reads as words whatever the markup. -->
        <dd class="flex flex-wrap items-baseline gap-x-2">
          <span
            class="font-semibold"
            :class="{ 'text-destructive': segment.id === 'overdue' && segment.value !== null }"
            ><template v-if="segment.value !== null"
              ><span
                class="text-lg font-bold tabular-nums"
                :data-testid="
                  segment.id === 'total' ? 'summary-known-outstanding' : 'summary-value'
                "
                >{{ segment.value }}</span
              >{{ ' ' }}</template
            >{{ segment.text }}</span
          ><template v-if="segment.note"
            >{{ ' '
            }}<span class="text-sm text-muted-foreground">{{ segment.note }}</span></template
          >
        </dd>
        <Button
          v-if="segment.id === 'unbilled' && segment.value !== null"
          variant="outline"
          class="h-8 shrink-0"
          data-testid="show-unbilled"
          @click="emit('showUnbilled')"
        >
          Show them
        </Button>
      </div>
    </dl>
  </section>
</template>
