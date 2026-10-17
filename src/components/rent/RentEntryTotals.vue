<script setup lang="ts">
import type { EntryTotals } from '@/utils/rentCalculations'
import { formatINR } from '@/utils/currency'

defineProps<{
  totals: EntryTotals
  // Void bills on the page, which the totals leave out.
  voidCount?: number
}>()
</script>

<template>
  <!-- Bills are paged: these add up the page on screen, never the tenant's whole balance. -->
  <section aria-labelledby="entry-totals-heading">
    <h2 id="entry-totals-heading" class="mb-3 text-sm font-medium text-muted-foreground">
      Totals for this page
    </h2>
    <!-- One strip of three figures, side by side even on a phone. -->
    <dl class="grid grid-cols-3 divide-x rounded-xl border">
      <div class="min-w-0 px-3 py-2.5 sm:px-4 sm:py-3">
        <dt class="text-xs text-muted-foreground sm:text-sm">Total billed</dt>
        <dd class="mt-0.5 font-semibold tabular-nums sm:text-lg">
          {{ formatINR(totals.totalBilled) }}
        </dd>
      </div>
      <div class="min-w-0 px-3 py-2.5 sm:px-4 sm:py-3">
        <dt class="text-xs text-muted-foreground sm:text-sm">Total paid</dt>
        <dd class="mt-0.5 font-semibold tabular-nums sm:text-lg">
          {{ formatINR(totals.totalPaid) }}
        </dd>
      </div>
      <div class="min-w-0 px-3 py-2.5 sm:px-4 sm:py-3">
        <dt class="text-xs text-muted-foreground sm:text-sm">Outstanding</dt>
        <dd class="mt-0.5 font-semibold tabular-nums sm:text-lg">
          {{ formatINR(totals.outstanding) }}
        </dd>
      </div>
    </dl>
    <p v-if="voidCount" class="mt-2 text-xs text-muted-foreground" data-testid="void-not-counted">
      {{ voidCount === 1 ? 'The void bill' : `The ${voidCount} void bills` }} on this page
      {{ voidCount === 1 ? "isn't" : "aren't" }} counted.
    </p>
  </section>
</template>
