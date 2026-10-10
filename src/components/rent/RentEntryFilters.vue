<script setup lang="ts">
import { computed, ref } from 'vue'
import { SlidersHorizontal, X } from '@lucide/vue'

import ToggleSwitch from '@/components/common/ToggleSwitch.vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { PaymentStatus } from '@/types/rentEntry'
import { formatPaymentStatus } from '@/utils/rentCalculations'

// The backend applies both filters before paging. showVoid lists void bills too: they're kept
// as history, so they're hidden unless asked for, and the payment status never matches them.
// The year and status sit in a panel the Filters button opens in place (pushing the bills
// down); Show void bills and Clear filters stay in the toolbar, so they're one tap away.
defineProps<{
  // Billing years to offer, newest first.
  years: string[]
}>()

const year = defineModel<string>('year', { required: true })
const status = defineModel<PaymentStatus | 'all'>('status', { required: true })
const showVoid = defineModel<boolean>('showVoid', { required: true })

const statuses: PaymentStatus[] = ['unpaid', 'partially_paid', 'paid']

const activeCount = computed(() => Number(year.value !== 'all') + Number(status.value !== 'all'))

// Open from the start when a filter already applies, so it's never hidden and in force.
const open = ref(activeCount.value > 0)

function clear() {
  year.value = 'all'
  status.value = 'all'
}

const selectClass =
  'h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm'
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          class="h-11"
          :class="open && 'border-primary/40 bg-accent text-accent-foreground hover:bg-accent'"
          aria-controls="history-filter-panel"
          :aria-expanded="open"
          data-testid="filters-toggle"
          @click="open = !open"
        >
          <X v-if="open" aria-hidden="true" />
          <SlidersHorizontal v-else aria-hidden="true" />
          Filters
          <span
            v-if="activeCount > 0"
            class="grid size-5 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums"
            data-testid="filters-count"
          >
            {{ activeCount }}<span class="sr-only"> applied</span>
          </span>
        </Button>
        <Button v-if="activeCount > 0" variant="ghost" class="h-11" @click="clear">
          Clear filters
        </Button>
      </div>

      <label
        class="flex min-h-11 cursor-pointer items-center gap-3 text-sm select-none"
        for="filter-show-void"
      >
        Show void bills
        <ToggleSwitch id="filter-show-void" v-model="showVoid" />
      </label>
    </div>

    <div
      id="history-filter-panel"
      class="collapsible"
      :data-open="open"
      :inert="open ? undefined : true"
      data-testid="filters-panel"
    >
      <!-- Padded out so the clipped panel doesn't cut off the selects' focus rings. -->
      <div class="-mx-1 px-1 pb-1">
        <div class="flex flex-col gap-3 pt-3 sm:flex-row sm:items-end">
          <div class="grid flex-1 gap-1.5">
            <Label for="filter-year">Billing year</Label>
            <select id="filter-year" v-model="year" :class="selectClass">
              <option value="all">All years</option>
              <option v-for="option in years" :key="option" :value="option">{{ option }}</option>
            </select>
          </div>
          <div class="grid flex-1 gap-1.5">
            <Label for="filter-status">Payment status</Label>
            <select id="filter-status" v-model="status" :class="selectClass">
              <option value="all">All</option>
              <option v-for="option in statuses" :key="option" :value="option">
                {{ formatPaymentStatus(option) }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
