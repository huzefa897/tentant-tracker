<script setup lang="ts">
import { computed } from 'vue'

import type { RentalPeriodRow } from '@/types/dashboard'
import { formatPeriodTiming } from '@/utils/rentalPeriods'

// When a rental month is due, as words ("Overdue 4 days", "Due today", "Due in 3 days"), never
// by colour alone. Only late months take colour, outlined rather than tinted so the text keeps
// its contrast.
const props = defineProps<{
  period: Pick<RentalPeriodRow, 'timing' | 'daysOverdue' | 'dueDate'>
  // Today at the property (the summary's asOfDate), for "Due in 3 days".
  asOfDate: string
}>()

const label = computed(() =>
  formatPeriodTiming(
    props.period.timing,
    props.period.daysOverdue,
    props.period.dueDate,
    props.asOfDate,
  ),
)

const tone = computed(() => {
  if (props.period.timing === 'overdue') return 'border-destructive/40 text-destructive'
  if (props.period.timing === 'due_today') return 'border-warning/40 text-warning'
  return 'text-muted-foreground'
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap"
    :class="tone"
    data-testid="period-status"
  >
    <span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
    {{ label }}
  </span>
</template>
