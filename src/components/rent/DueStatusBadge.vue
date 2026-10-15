<script setup lang="ts">
import { CalendarClock } from '@lucide/vue'

import type { DueStatus } from '@/types/rentEntry'
import { formatDueStatus } from '@/utils/rentCalculations'

// Late money only: Overdue, or Due today. Upcoming and settled bills need no flag beside their
// payment status, so it shows nothing for them (or for a bill with no due date).
defineProps<{
  status: DueStatus | null
}>()
</script>

<template>
  <span
    v-if="status === 'overdue' || status === 'due_today'"
    class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium"
    :class="
      status === 'overdue'
        ? 'border-destructive/40 text-destructive'
        : 'border-warning/40 text-warning'
    "
    data-testid="due-status-badge"
  >
    <CalendarClock class="size-3.5" aria-hidden="true" />
    {{ formatDueStatus(status) }}
  </span>
</template>
