<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from '@lucide/vue'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import { Button } from '@/components/ui/button'
import type { RentEntry } from '@/types/rentEntry'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'

// Shown in the given order, with the figures the backend calculated. Receipts are issued per
// payment, on the entry's details page.
const props = defineProps<{
  entries: RentEntry[]
}>()

const emit = defineEmits<{
  view: [entryId: string]
}>()

const rows = computed(() =>
  props.entries.map((entry) => ({
    id: entry.id,
    month: formatMonthValue(entry.billingMonth),
    totalDue: entry.totalDue,
    totalPaid: entry.totalPaid,
    outstanding: entry.outstanding,
    status: entry.status,
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
              <div class="flex justify-end">
                <Button
                  variant="ghost"
                  class="h-10"
                  :aria-label="`View summary for ${row.month}`"
                  @click="emit('view', row.id)"
                >
                  View Summary
                </Button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile -->
    <ul class="space-y-3 md:hidden">
      <li
        v-for="row in rows"
        :key="row.id"
        class="rounded-xl border bg-card p-4"
        data-testid="history-card"
      >
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
          <Button
            variant="outline"
            class="h-11 w-full"
            :aria-label="`View summary for ${row.month}`"
            @click="emit('view', row.id)"
          >
            View Summary
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </li>
    </ul>
  </div>
</template>
