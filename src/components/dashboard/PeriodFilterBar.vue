<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDays, ChevronDown, FileText, X } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { PreparationFilter, TimingFilter } from '@/types/dashboard'
import { formatMonthValue } from '@/utils/date'
import { formatMonthCount } from '@/utils/rentalPeriods'

// Which months the list shows: whether their bill is prepared and one rental month (beside the
// list's heading, slot `heading`), then by when they're due (tab-like toggle buttons,
// aria-pressed, with how many months each has). Each select shows its name and value over a
// native select, which stays the control (keyboard, screen readers, the phone's picker). The
// summary never changes with them.
const props = defineProps<{
  // Rental months to offer (YYYY-MM), newest first.
  months: string[]
  // How many months each timing has across the property (from the summary); left out while
  // the bill or month filter narrows the list, when they'd count months it doesn't show.
  counts?: Partial<Record<TimingFilter, number>>
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
    <div class="flex flex-col gap-2 px-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
      <slot name="heading" />
      <div class="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <div
          v-for="select in selects"
          :key="select.id"
          class="relative flex h-10 min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/50 has-[select:focus-visible]:border-ring has-[select:focus-visible]:ring-3 has-[select:focus-visible]:ring-ring/50 has-[select:disabled]:opacity-50 sm:w-48"
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
          class="col-span-2 h-10 w-fit"
          :disabled="disabled"
          @click="emit('clear')"
        >
          <X aria-hidden="true" />
          Clear filters
        </Button>
      </div>
    </div>

    <!-- Wraps on narrow phones rather than scrolling sideways, so every option stays in view. -->
    <div class="border-b px-1 sm:px-2.5" role="group" aria-label="Due">
      <div class="flex flex-wrap sm:gap-x-1">
        <button
          v-for="option in timings"
          :key="option.value"
          type="button"
          class="-mb-px flex h-10 items-center gap-1 rounded-t-md border-b-2 border-transparent px-1.5 text-sm sm:gap-1.5 sm:px-2.5 font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-primary aria-pressed:text-foreground"
          :aria-pressed="timing === option.value"
          :disabled="disabled"
          :data-testid="`timing-filter-${option.value}`"
          @click="timing = option.value"
        >
          {{ option.label }}
          <template v-if="counts?.[option.value] !== undefined">
            <span
              class="min-w-6 rounded-full px-1.5 text-center text-xs tabular-nums"
              :class="
                timing === option.value
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground'
              "
              aria-hidden="true"
              data-testid="timing-count"
              >{{ counts[option.value] }}</span
            >
            <span class="sr-only">({{ formatMonthCount(counts[option.value]!) }})</span>
          </template>
        </button>
      </div>
    </div>
  </div>
</template>
