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
    <!-- Stacked rows on phones, each label beside its amount, so a large total (₹1,00,00,000 and
         more on a page) has the width it needs; one strip of three from sm up. -->
    <dl
      class="grid divide-y rounded-xl border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      data-testid="entry-totals"
    >
      <div
        v-for="figure in [
          { label: 'Total billed', amount: totals.totalBilled },
          { label: 'Total paid', amount: totals.totalPaid },
          { label: 'Outstanding', amount: totals.outstanding },
        ]"
        :key="figure.label"
        class="flex min-w-0 items-baseline justify-between gap-3 px-3 py-2.5 sm:block sm:px-4 sm:py-3"
      >
        <dt class="text-sm text-muted-foreground">{{ figure.label }}</dt>
        <dd class="font-semibold break-all tabular-nums sm:mt-0.5 sm:text-lg">
          {{ formatINR(figure.amount) }}
        </dd>
      </div>
    </dl>
    <p v-if="voidCount" class="mt-2 text-xs text-muted-foreground" data-testid="void-not-counted">
      {{ voidCount === 1 ? 'The void bill' : `The ${voidCount} void bills` }} on this page
      {{ voidCount === 1 ? "isn't" : "aren't" }} counted.
    </p>
  </section>
</template>
