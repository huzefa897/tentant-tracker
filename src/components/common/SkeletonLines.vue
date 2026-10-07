<script setup lang="ts">
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

// Label-and-value lines, the shape of the app's figure lists (charges, totals, summaries).
// card: inside a bordered card, like the sections they stand in for. heading: a title line
// first. action: a full-width button below.
withDefaults(
  defineProps<{
    lines?: number
    heading?: boolean
    card?: boolean
    action?: boolean
  }>(),
  { lines: 3 },
)

// Varied label widths, so the lines read as text rather than a grid.
const LABEL_WIDTHS = ['w-28', 'w-20', 'w-32', 'w-24']
</script>

<template>
  <div :class="cn(card && 'rounded-xl border p-4 sm:p-6')">
    <Skeleton v-if="heading" class="mb-4 h-5 w-28" />
    <div class="space-y-3">
      <div v-for="line in lines" :key="line" class="flex justify-between gap-4">
        <Skeleton :class="cn('h-4', LABEL_WIDTHS[(line - 1) % LABEL_WIDTHS.length])" />
        <Skeleton class="h-4 w-16" />
      </div>
    </div>
    <Skeleton v-if="action" class="mt-4 h-11 w-full" />
  </div>
</template>
