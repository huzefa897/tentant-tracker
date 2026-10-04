<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, Printer } from '@lucide/vue'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import { Button } from '@/components/ui/button'
import type { RentEntry } from '@/types/rentEntry'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'
import { type BilledEntry, getEntryAmounts } from '@/utils/rentCalculations'

// Shown in the given order; the page sorts and filters, and sums each bill's payments.
const props = defineProps<{
  bills: BilledEntry<RentEntry>[]
}>()

const emit = defineEmits<{
  view: [entryId: string]
  // Only offered for bills with a payment: a receipt confirms money received.
  'view-receipt': [entryId: string]
}>()

// Calculated once and shared by the table and the cards.
const rows = computed(() =>
  props.bills.map(({ entry, totalPaid }) => ({
    id: entry.id,
    month: formatMonthValue(entry.billingMonth),
    ...getEntryAmounts(entry, totalPaid),
  })),
)
</script>

<template>
  <div>
    <!-- Desktop -->
    <div class="hidden overflow-x-auto rounded-xl border md:block">
      <table class="w-full text-sm">
        <thead class="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">Billing month</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Total due</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Total paid</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Outstanding</th>
            <th scope="col" class="px-4 py-3 font-medium">Status</th>
            <th scope="col" class="px-4 py-3"><span class="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="border-t" data-testid="history-row">
            <th scope="row" class="px-4 py-3 text-left font-medium">{{ row.month }}</th>
            <td class="px-4 py-3 text-right tabular-nums">{{ formatINR(row.totalDue) }}</td>
            <td class="px-4 py-3 text-right tabular-nums">{{ formatINR(row.totalPaid) }}</td>
            <td class="px-4 py-3 text-right font-semibold tabular-nums">
              {{ formatINR(row.outstanding) }}
            </td>
            <td class="px-4 py-3">
              <PaymentStatusBadge :status="row.status" />
            </td>
            <td class="px-4 py-2">
              <div class="flex justify-end gap-2">
                <Button variant="ghost" class="h-10" :aria-label="`View summary for ${row.month}`"
                  @click="emit('view', row.id)">
                  View Summary
                </Button>
                <Button v-if="row.totalPaid > 0" variant="outline" class="h-10"
                  :aria-label="`View or print receipt for ${row.month}`" @click="emit('view-receipt', row.id)">
                  <Printer aria-hidden="true" />
                  Print Receipt
                </Button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile -->
    <ul class="space-y-3 md:hidden">
      <li v-for="row in rows" :key="row.id" class="rounded-xl border bg-card p-4" data-testid="history-card">
        <div class="flex items-center justify-between gap-3">
          <h3 class="font-semibold">{{ row.month }}</h3>
          <PaymentStatusBadge :status="row.status" />
        </div>
        <dl class="mt-3 space-y-1.5 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Total due</dt>
            <dd class="tabular-nums">{{ formatINR(row.totalDue) }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Total paid</dt>
            <dd class="tabular-nums">{{ formatINR(row.totalPaid) }}</dd>
          </div>
          <div class="flex justify-between gap-4 font-semibold">
            <dt>Outstanding</dt>
            <dd class="tabular-nums">{{ formatINR(row.outstanding) }}</dd>
          </div>
        </dl>
        <div class="mt-4 grid gap-2">
          <Button variant="outline" class="h-11 w-full" :aria-label="`View summary for ${row.month}`"
            @click="emit('view', row.id)">
            View Summary
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button v-if="row.totalPaid > 0" variant="outline" class="h-11 w-full"
            :aria-label="`View or print receipt for ${row.month}`" @click="emit('view-receipt', row.id)">
            <Printer aria-hidden="true" />
            Print Receipt
          </Button>
        </div>
      </li>
    </ul>
  </div>
</template>
