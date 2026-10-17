<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDays, CircleAlert, Clock, Wallet } from '@lucide/vue'

import type { DashboardSummary } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatMonthCount, formatTenantCount } from '@/utils/rentalPeriods'

// The property's rent due as four figures: rental months overdue, due today and due in the next
// 7 days, each with the amount known from their prepared bills, then the total known outstanding.
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

const tiles = computed(() => {
  const s = props.summary
  const months = (count: number, amount: number, none: string, extra?: string) => ({
    count,
    unit: count === 1 ? 'month' : 'months',
    note: count > 0 ? [extra, `${formatINR(amount)} from bills`].filter(Boolean).join(' · ') : none,
  })
  return [
    {
      id: 'overdue',
      label: 'Overdue',
      icon: CircleAlert,
      tone: (s.overduePeriodCount > 0 ? 'late' : 'quiet') as Tone,
      ...months(
        s.overduePeriodCount,
        s.knownOverdue,
        'Nothing late',
        formatTenantCount(s.overdueTenancyCount),
      ),
    },
    {
      id: 'due-today',
      label: 'Due today',
      icon: Clock,
      tone: (s.dueTodayPeriodCount > 0 ? 'soon' : 'quiet') as Tone,
      ...months(s.dueTodayPeriodCount, s.knownDueToday, 'Nothing due today'),
    },
    {
      id: 'upcoming',
      label: 'Due in the next 7 days',
      icon: CalendarDays,
      tone: 'quiet' as Tone,
      ...months(s.upcomingPeriodCount, s.knownUpcoming, 'Nothing due this week'),
    },
  ]
})

const ICON_TONES: Record<Tone, string> = {
  late: 'bg-destructive/10 text-destructive',
  soon: 'bg-warning/10 text-warning',
  quiet: 'bg-muted text-muted-foreground',
}
const VALUE_TONES: Record<Tone, string> = {
  late: 'text-destructive',
  soon: 'text-warning',
  quiet: '',
}
</script>

<template>
  <section aria-labelledby="summary-heading" data-testid="dashboard-summary">
    <h2 id="summary-heading" class="sr-only">Summary</h2>
    <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div
        v-for="tile in tiles"
        :key="tile.id"
        class="flex flex-col gap-1 rounded-2xl border bg-card p-4 sm:p-5"
        :data-testid="`summary-${tile.id}`"
      >
        <dt class="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-lg"
            :class="ICON_TONES[tile.tone]"
            aria-hidden="true"
          >
            <component :is="tile.icon" class="size-4" />
          </span>
          {{ tile.label }}
        </dt>
        <dd class="mt-1">
          <span
            class="text-3xl font-bold tracking-tight tabular-nums"
            :class="VALUE_TONES[tile.tone]"
            data-testid="summary-value"
            >{{ tile.count }}</span
          >
          <!-- The space is in the text, so "2 months" reads as two words whatever the markup. -->
          <span class="text-sm text-muted-foreground">{{ ` ${tile.unit}` }}</span>
        </dd>
        <dd class="text-sm text-muted-foreground">{{ tile.note }}</dd>
      </div>

      <div
        class="flex flex-col gap-1 rounded-2xl border bg-card p-4 sm:p-5"
        data-testid="summary-total"
      >
        <dt class="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Wallet class="size-4" />
          </span>
          Total outstanding
        </dt>
        <dd
          class="mt-1 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl"
          data-testid="summary-known-outstanding"
        >
          {{ formatINR(summary.knownOutstanding) }}
        </dd>
        <dd class="text-sm text-muted-foreground" data-testid="summary-owing-tenants">
          {{
            summary.owingTenancyCount > 0
              ? `${formatTenantCount(summary.owingTenancyCount)} owing`
              : 'Nobody owes rent'
          }}
        </dd>
      </div>
    </dl>
    <p class="mt-3 max-w-prose text-sm text-muted-foreground" data-testid="summary-excluded">
      {{ excluded }}
    </p>
  </section>
</template>
