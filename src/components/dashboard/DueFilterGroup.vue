<script setup lang="ts">
import type { DueFilter } from '@/types/dashboard'

// Which tenancies the list shows: everyone who owes, or those with money in one window. A set
// of toggle buttons (aria-pressed), one pressed at a time; the summary never changes with it.
const filter = defineModel<DueFilter>({ required: true })

defineProps<{
  disabled?: boolean
}>()

const options: { value: DueFilter; label: string }[] = [
  { value: 'all', label: 'All pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_today', label: 'Due today' },
  { value: 'due_next_7_days', label: 'Next 7 days' },
]
</script>

<template>
  <div
    class="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1 sm:inline-grid sm:grid-cols-4"
    role="group"
    aria-label="Show"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="h-10 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
      :aria-pressed="filter === option.value"
      :disabled="disabled"
      :data-testid="`due-filter-${option.value}`"
      @click="filter = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
