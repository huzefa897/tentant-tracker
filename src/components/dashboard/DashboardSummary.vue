<script setup lang="ts">
import { computed } from 'vue'

import type { DashboardSummary } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatMonthCount, formatTenantCount } from '@/utils/rentalPeriods'

// The property's rent due: what's known to be outstanding from prepared bills, then counts of
// rental months by when they're due and whether their bill is prepared. Counts of months are
// never called tenants; a month awaiting its bill is counted, never added to the amount, and
// the figure says so. Only late money takes colour.
const props = defineProps<{
  summary: DashboardSummary
}>()

const excluded = computed(() => {
  const awaiting = props.summary.awaitingBillPeriodCount
  if (awaiting === 0) return 'From prepared bills. Every month that’s owed has its bill.'
  return `From prepared bills only. ${formatMonthCount(awaiting)} awaiting a bill ${
    awaiting === 1 ? 'isn’t' : 'aren’t'
  } included: ${awaiting === 1 ? 'its amount isn’t' : 'their amounts aren’t'} calculated yet.`
})

const parts = computed(() => {
  const s = props.summary
  return [
    {
      id: 'overdue',
      label: 'Overdue',
      value: formatMonthCount(s.overduePeriodCount),
      note:
        s.overduePeriodCount > 0
          ? `${formatTenantCount(s.overdueTenancyCount)} · ${formatINR(s.knownOverdue)} known`
          : 'Nothing late',
      late: s.overduePeriodCount > 0,
      soon: false,
    },
    {
      id: 'due-today',
      label: 'Due today',
      value: formatMonthCount(s.dueTodayPeriodCount),
      note: s.dueTodayPeriodCount > 0 ? `${formatINR(s.knownDueToday)} known` : null,
      late: false,
      soon: s.dueTodayPeriodCount > 0,
    },
    {
      id: 'awaiting-bill',
      label: 'Awaiting a bill',
      value: formatMonthCount(s.awaitingBillPeriodCount),
      note:
        s.overdueAwaitingBillPeriodCount > 0
          ? `${s.overdueAwaitingBillPeriodCount} of them overdue`
          : null,
      late: false,
      soon: false,
    },
    {
      id: 'upcoming',
      label: 'Due in the next 7 days',
      value: formatMonthCount(s.upcomingPeriodCount),
      note: null,
      late: false,
      soon: false,
    },
  ]
})
</script>

<template>
  <section
    class="rounded-2xl border bg-card p-5 sm:p-6"
    aria-labelledby="outstanding-heading"
    data-testid="dashboard-summary"
  >
    <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-end">
      <div>
        <h2 id="outstanding-heading" class="text-sm font-medium text-muted-foreground">
          Known outstanding
        </h2>
        <p
          class="mt-1 text-4xl font-bold tracking-tight tabular-nums"
          data-testid="summary-known-outstanding"
        >
          {{ formatINR(summary.knownOutstanding) }}
        </p>
        <p class="mt-1.5 max-w-prose text-sm text-muted-foreground" data-testid="summary-excluded">
          {{ excluded }}
        </p>
      </div>

      <div>
        <p class="mb-2 text-sm text-muted-foreground">
          Rental months still owed
          <span v-if="summary.owingTenancyCount > 0" data-testid="summary-owing-tenants">
            · {{ formatTenantCount(summary.owingTenancyCount) }}
          </span>
        </p>
        <dl class="grid divide-y border-t sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <div
            v-for="part in parts"
            :key="part.id"
            class="flex items-baseline justify-between gap-3 py-3 sm:block sm:px-4 sm:first:pl-0"
            :data-testid="`summary-${part.id}`"
          >
            <dt class="text-sm text-muted-foreground">{{ part.label }}</dt>
            <dd class="text-right sm:mt-1 sm:text-left">
              <span
                class="text-lg font-semibold tabular-nums"
                :class="{ 'text-destructive': part.late, 'text-warning': part.soon }"
              >
                {{ part.value }}
              </span>
              <span v-if="part.note" class="block text-xs text-muted-foreground">
                {{ part.note }}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
