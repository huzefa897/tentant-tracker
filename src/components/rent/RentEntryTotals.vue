<script setup lang="ts">
import type { EntryTotals } from '@/utils/rentCalculations'
import { formatINR } from '@/utils/currency'

defineProps<{
  totals: EntryTotals
}>()
</script>

<template>
  <!-- Bills are paged: these add up the page on screen, never the tenant's whole balance. -->
  <section aria-labelledby="entry-totals-heading">
    <h2 id="entry-totals-heading" class="mb-3 text-sm font-medium text-muted-foreground">
      Totals for this page
    </h2>
    <dl class="grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl border bg-muted/40 p-4">
        <dt class="text-xs text-muted-foreground">Total billed</dt>
        <dd class="mt-1 text-lg font-semibold tabular-nums">{{ formatINR(totals.totalBilled) }}</dd>
      </div>
      <div class="rounded-xl border bg-muted/40 p-4">
        <dt class="text-xs text-muted-foreground">Total paid</dt>
        <dd class="mt-1 text-lg font-semibold tabular-nums">{{ formatINR(totals.totalPaid) }}</dd>
      </div>
      <div class="rounded-xl border bg-muted/40 p-4">
        <dt class="text-xs text-muted-foreground">Outstanding</dt>
        <dd class="mt-1 text-lg font-semibold tabular-nums">{{ formatINR(totals.outstanding) }}</dd>
      </div>
    </dl>
  </section>
</template>
