<script setup lang="ts">
import type { RentEntry } from '@/types/rentEntry'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'

// Who a bill's reminder goes to and what it's about, for the confirm dialog.
defineProps<{
  tenant: Pick<Tenant, 'name' | 'flatNumber'>
  entry: Pick<RentEntry, 'billingMonth' | 'outstanding'>
}>()
</script>

<template>
  <dl class="space-y-1.5 rounded-xl border bg-muted/40 p-4 text-sm" data-testid="reminder-bill">
    <div class="flex justify-between gap-4">
      <dt class="text-muted-foreground">Tenant</dt>
      <dd class="text-right font-medium">{{ tenant.name }} · Flat {{ tenant.flatNumber }}</dd>
    </div>
    <div class="flex justify-between gap-4">
      <dt class="text-muted-foreground">Billing month</dt>
      <dd class="font-medium">{{ formatMonthValue(entry.billingMonth) }}</dd>
    </div>
    <div class="flex justify-between gap-4">
      <dt class="text-muted-foreground">Outstanding</dt>
      <dd class="font-semibold tabular-nums">{{ formatINR(entry.outstanding) }}</dd>
    </div>
  </dl>
</template>
