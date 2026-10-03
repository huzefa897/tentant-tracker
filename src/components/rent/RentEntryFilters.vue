<script setup lang="ts">
import { computed } from 'vue'
import { X } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { PaymentStatus } from '@/types/rentEntry'
import { formatPaymentStatus } from '@/utils/rentCalculations'

defineProps<{
  // Billing years present in the tenant's entries, newest first.
  years: string[]
}>()

const year = defineModel<string>('year', { required: true })
const status = defineModel<PaymentStatus | 'all'>('status', { required: true })

const statuses: PaymentStatus[] = ['unpaid', 'partially_paid', 'paid']

const active = computed(() => year.value !== 'all' || status.value !== 'all')

function clear() {
  year.value = 'all'
  status.value = 'all'
}

const selectClass =
  'h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm'
</script>

<template>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
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
    <Button v-if="active" variant="ghost" class="h-11" @click="clear">
      <X aria-hidden="true" />
      Clear filters
    </Button>
  </div>
</template>
