<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDays, ChevronDown, CircleCheck, X } from '@lucide/vue'

import ToggleSwitch from '@/components/common/ToggleSwitch.vue'
import { Button } from '@/components/ui/button'
import type { PaymentStatus } from '@/types/rentEntry'
import { formatPaymentStatus } from '@/utils/rentCalculations'

// The backend applies both filters before paging. showVoid lists void bills too: they're kept
// as history, so they're hidden unless asked for, and the payment status never matches them.
// A filter bar: each filter shows its name and current value ("Billing period: 2026") over a
// native select, which stays the control (keyboard, screen readers, the phone's picker).
const props = defineProps<{
  // Billing years to offer, newest first.
  years: string[]
}>()

const year = defineModel<string>('year', { required: true })
const status = defineModel<PaymentStatus | 'all'>('status', { required: true })
const showVoid = defineModel<boolean>('showVoid', { required: true })

const statuses: PaymentStatus[] = ['unpaid', 'partially_paid', 'paid']

const active = computed(() => year.value !== 'all' || status.value !== 'all')

const filters = computed(() => [
  {
    id: 'filter-year',
    label: 'Billing period',
    icon: CalendarDays,
    selected: year.value,
    shown: year.value === 'all' ? 'All' : year.value,
    options: [
      { value: 'all', label: 'All years' },
      ...props.years.map((option) => ({ value: option, label: option })),
    ],
  },
  {
    id: 'filter-status',
    label: 'Status',
    icon: CircleCheck,
    selected: status.value,
    shown: status.value === 'all' ? 'All' : formatPaymentStatus(status.value),
    options: [
      { value: 'all', label: 'All' },
      ...statuses.map((option) => ({ value: option, label: formatPaymentStatus(option) })),
    ],
  },
])

function choose(id: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (id === 'filter-year') year.value = value
  else status.value = value as PaymentStatus | 'all'
}

function clear() {
  year.value = 'all'
  status.value = 'all'
}
</script>

<template>
  <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
    <div class="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
      <div
        v-for="filter in filters"
        :key="filter.id"
        class="relative flex h-11 min-w-0 items-center gap-3 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/50 has-[select:focus-visible]:border-ring has-[select:focus-visible]:ring-3 has-[select:focus-visible]:ring-ring/50 sm:max-w-xs sm:flex-1"
      >
        <component
          :is="filter.icon"
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate" aria-hidden="true" data-testid="filter-summary">
          <span class="text-muted-foreground">{{ `${filter.label}: ` }}</span>
          <span class="font-semibold">{{ filter.shown }}</span>
        </span>
        <ChevronDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <select
          :id="filter.id"
          :value="filter.selected"
          :aria-label="filter.label"
          class="absolute inset-0 size-full cursor-pointer opacity-0"
          @change="choose(filter.id, $event)"
        >
          <option v-for="option in filter.options" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <Button v-if="active" variant="ghost" class="h-11 w-fit" @click="clear">
        <X aria-hidden="true" />
        Clear filters
      </Button>
    </div>

    <label
      class="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm text-muted-foreground select-none lg:ml-auto"
      for="filter-show-void"
    >
      Include void bills
      <ToggleSwitch id="filter-show-void" v-model="showVoid" />
    </label>
  </div>
</template>
