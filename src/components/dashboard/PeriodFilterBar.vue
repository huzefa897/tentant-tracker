<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDays, ChevronDown, FileText, X } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { PreparationFilter, TimingFilter } from '@/types/dashboard'
import { formatMonthValue } from '@/utils/date'

// Which months the list shows: by when they're due (toggle buttons, aria-pressed), whether
// their bill is prepared, and one rental month. Each select shows its name and value over a
// native select, which stays the control (keyboard, screen readers, the phone's picker). The
// summary never changes with them.
const props = defineProps<{
  // Rental months to offer (YYYY-MM), newest first.
  months: string[]
  disabled?: boolean
}>()

const timing = defineModel<TimingFilter>('timing', { required: true })
const preparation = defineModel<PreparationFilter>('preparation', { required: true })
const month = defineModel<string | null>('month', { required: true })

const emit = defineEmits<{
  // Back to every bill and every month, in one change.
  clear: []
}>()

const timings: { value: TimingFilter; label: string }[] = [
  { value: 'due', label: 'Due now' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_today', label: 'Due today' },
  { value: 'upcoming', label: 'Next 7 days' },
  { value: 'all', label: 'All owed' },
]

const PREPARATIONS: Record<PreparationFilter, string> = {
  all: 'All',
  prepared: 'Prepared',
  not_prepared: 'Not prepared',
}

const ALL_MONTHS = 'all'

const selects = computed(() => [
  {
    id: 'filter-preparation',
    label: 'Bill',
    icon: FileText,
    selected: preparation.value,
    shown: PREPARATIONS[preparation.value],
    options: (Object.keys(PREPARATIONS) as PreparationFilter[]).map((value) => ({
      value,
      label: value === 'all' ? 'All bills' : PREPARATIONS[value],
    })),
  },
  {
    id: 'filter-month',
    label: 'Month',
    icon: CalendarDays,
    selected: month.value ?? ALL_MONTHS,
    shown: month.value ? formatMonthValue(month.value) : 'All',
    options: [
      { value: ALL_MONTHS, label: 'All months' },
      ...props.months.map((value) => ({ value, label: formatMonthValue(value) })),
    ],
  },
])

const narrowed = computed(() => preparation.value !== 'all' || month.value !== null)

function choose(id: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (id === 'filter-preparation') preparation.value = value as PreparationFilter
  else month.value = value === ALL_MONTHS ? null : value
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="flex flex-wrap gap-1 rounded-xl border bg-muted/40 p-1 sm:w-fit"
      role="group"
      aria-label="Due"
    >
      <button
        v-for="option in timings"
        :key="option.value"
        type="button"
        class="h-10 flex-1 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm sm:flex-none"
        :aria-pressed="timing === option.value"
        :disabled="disabled"
        :data-testid="`timing-filter-${option.value}`"
        @click="timing = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div
        v-for="select in selects"
        :key="select.id"
        class="relative flex h-11 min-w-0 items-center gap-3 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/50 has-[select:focus-visible]:border-ring has-[select:focus-visible]:ring-3 has-[select:focus-visible]:ring-ring/50 has-[select:disabled]:opacity-50 sm:max-w-xs sm:flex-1"
      >
        <component
          :is="select.icon"
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate" aria-hidden="true" data-testid="filter-summary">
          <span class="text-muted-foreground">{{ `${select.label}: ` }}</span>
          <span class="font-semibold">{{ select.shown }}</span>
        </span>
        <ChevronDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <select
          :id="select.id"
          :value="select.selected"
          :aria-label="select.label"
          :disabled="disabled"
          class="absolute inset-0 size-full cursor-pointer opacity-0"
          :data-testid="select.id"
          @change="choose(select.id, $event)"
        >
          <option v-for="option in select.options" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <Button
        v-if="narrowed"
        variant="ghost"
        class="h-11 w-fit"
        :disabled="disabled"
        @click="emit('clear')"
      >
        <X aria-hidden="true" />
        Clear filters
      </Button>
    </div>
  </div>
</template>
