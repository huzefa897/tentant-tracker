<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDays, CircleAlert, Clock, Wallet } from '@lucide/vue'

import type { DashboardSummary } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatMonthCount, formatTenantCount } from '@/utils/rentalPeriods'

// The property's rent due as four small figures: rental months overdue, due today and due in the
// next 7 days, each with the amount known from their prepared bills, then the total known
// outstanding and how many tenants owe it.
// Counts of months are never called tenants; a month awaiting its bill is counted, never added
// to an amount, and the line below says so. Only late money takes colour.
const props = defineProps<{
  summary: DashboardSummary
}>()

const excluded = computed(() => {
  const awaiting = props.summary.awaitingBillPeriodCount
  if (awaiting === 0) return 'From prepared bills. Every month that’s owed has its bill.'
  const overdue = props.summary.overdueAwaitingBillPeriodCount
  return `From prepared bills only. ${formatMonthCount(awaiting)} awaiting a bill${
    overdue > 0 ? ` (${overdue} overdue)` : ''
  } ${awaiting === 1 ? 'isn’t' : 'aren’t'} included: ${
    awaiting === 1 ? 'its amount isn’t' : 'their amounts aren’t'
  } calculated yet.`
})

type Tone = 'late' | 'soon' | 'quiet'

// Each tile is two lines: the label, then "3 months · ₹68,000" (the amount only when there are
// some; the line below the tiles says it's from prepared bills).
const tiles = computed(() => {
  const s = props.summary
  const months = (count: number, amount: number) => ({
    count,
    unit: count === 1 ? 'month' : 'months',
    note: count > 0 ? formatINR(amount) : null,
  })
  return [
    {
      id: 'overdue',
      label: 'Overdue',
      icon: CircleAlert,
      tone: (s.overduePeriodCount > 0 ? 'late' : 'quiet') as Tone,
      ...months(s.overduePeriodCount, s.knownOverdue),
    },
    {
      id: 'due-today',
      label: 'Due today',
      icon: Clock,
      tone: (s.dueTodayPeriodCount > 0 ? 'soon' : 'quiet') as Tone,
      ...months(s.dueTodayPeriodCount, s.knownDueToday),
    },
    {
      id: 'upcoming',
      label: 'Next 7 days',
      icon: CalendarDays,
      tone: 'quiet' as Tone,
      ...months(s.upcomingPeriodCount, s.knownUpcoming),
    },
  ]
})

const ICON_TONES: Record<Tone, string> = {
  late: 'text-destructive',
  soon: 'text-warning',
  quiet: '',
}
const VALUE_TONES: Record<Tone, string> = { ...ICON_TONES, quiet: 'text-foreground' }
</script>

<template>
  <section aria-labelledby="summary-heading" data-testid="dashboard-summary">
    <h2 id="summary-heading" class="sr-only">Summary</h2>
    <dl class="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <div
        v-for="tile in tiles"
        :key="tile.id"
        class="rounded-lg border bg-card px-3 py-2"
        :data-testid="`summary-${tile.id}`"
      >
        <dt class="flex items-center gap-1.5 text-sm text-muted-foreground">
          <component
            :is="tile.icon"
            class="size-4 shrink-0"
            :class="ICON_TONES[tile.tone]"
            aria-hidden="true"
          />
          {{ tile.label }}
        </dt>
        <!-- The spaces are in the text, so "2 months · ₹5,750" reads as words whatever the markup. -->
        <dd class="text-sm text-muted-foreground">
          <span
            class="text-xl leading-7 font-bold tracking-tight tabular-nums"
            :class="VALUE_TONES[tile.tone]"
            data-testid="summary-value"
            >{{ tile.count }}</span
          >{{ ` ${tile.unit}` }}<template v-if="tile.note">{{ ` · ${tile.note}` }}</template>
        </dd>
      </div>

      <div class="rounded-lg border bg-card px-3 py-2" data-testid="summary-total">
        <dt class="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Wallet class="size-4 shrink-0" aria-hidden="true" />
          Total outstanding
        </dt>
        <dd class="text-sm text-muted-foreground">
          <span
            class="text-lg leading-7 font-bold tracking-tight text-foreground tabular-nums sm:text-xl"
            data-testid="summary-known-outstanding"
            >{{ formatINR(summary.knownOutstanding) }}</span
          >{{ ' · '
          }}<span class="whitespace-nowrap" data-testid="summary-owing-tenants">{{
            summary.owingTenancyCount > 0
              ? formatTenantCount(summary.owingTenancyCount)
              : 'nobody owes'
          }}</span>
        </dd>
      </div>
    </dl>
    <p class="mt-2 max-w-prose text-sm text-muted-foreground" data-testid="summary-excluded">
      {{ excluded }}
    </p>
  </section>
</template>
