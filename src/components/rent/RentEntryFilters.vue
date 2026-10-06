<script setup lang="ts">
import { X } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

// Payment status filtering returns with payments (BE Phase 5): until then every bill is unpaid.
defineProps<{
  // Billing years to offer, newest first.
  years: string[]
}>()

const year = defineModel<string>('year', { required: true })

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
    <Button v-if="year !== 'all'" variant="ghost" class="h-11" @click="year = 'all'">
      <X aria-hidden="true" />
      Clear filters
    </Button>
  </div>
</template>
