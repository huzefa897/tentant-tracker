<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { PendingTenancy } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatDateValue } from '@/utils/date'

// Tenancies that owe money, in the backend's order (overdue first, oldest overdue first). One
// row per tenancy, so a flat's earlier and later occupants stay apart; an ended tenancy says so.
const props = defineProps<{
  tenancies: PendingTenancy[]
}>()

const emit = defineEmits<{
  // Their bills with money still to pay.
  view: [tenantId: string]
}>()

const rows = computed(() =>
  props.tenancies.map((tenancy) => ({
    ...tenancy,
    who: `${tenancy.name} · Flat ${tenancy.flatNumber}`,
    ended: tenancy.tenancyStatus === 'ended',
    late: tenancy.overdue > 0,
    // The oldest unpaid bill's due date; a bill from before due dates has none.
    oldestDue: tenancy.oldestDueDate ? formatDateValue(tenancy.oldestDueDate) : 'No due date',
    // "Flat 202 · 2 bills · Ended tenancy"
    detail: [
      `Flat ${tenancy.flatNumber}`,
      tenancy.pendingBillCount === 1 ? '1 bill' : `${tenancy.pendingBillCount} bills`,
      tenancy.tenancyStatus === 'ended' ? 'Ended tenancy' : null,
    ]
      .filter(Boolean)
      .join(' · '),
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
            <th scope="col" class="px-4 py-3 font-medium">Tenant</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Overdue</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Outstanding</th>
            <th scope="col" class="px-4 py-3 font-medium">Oldest unpaid due</th>
            <th scope="col" class="px-4 py-3"><span class="sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.tenantId" class="border-t" data-testid="pending-row">
            <th scope="row" class="px-4 py-3 text-left font-medium">
              <span class="block">{{ row.name }}</span>
              <!-- Read aloud as "Shaik Zahid Ali, Flat 202 · 2 bills". -->
              <span class="sr-only">, </span>
              <span class="block text-sm font-normal text-muted-foreground">
                {{ row.detail }}
              </span>
            </th>
            <td
              class="px-4 py-3 text-right tabular-nums"
              :class="row.late ? 'font-semibold text-destructive' : 'text-muted-foreground'"
            >
              {{ row.late ? formatINR(row.overdue) : '—' }}
            </td>
            <td class="px-4 py-3 text-right font-semibold tabular-nums">
              {{ formatINR(row.outstanding) }}
            </td>
            <td class="px-4 py-3 whitespace-nowrap">{{ row.oldestDue }}</td>
            <td class="px-4 py-2 text-right">
              <Button
                variant="ghost"
                class="h-10"
                :aria-label="`View the unpaid bills of ${row.who}`"
                @click="emit('view', row.tenantId)"
              >
                View bills
                <ChevronRight aria-hidden="true" />
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile -->
    <ul class="space-y-3 md:hidden">
      <li
        v-for="row in rows"
        :key="row.tenantId"
        class="rounded-xl border bg-card p-4"
        data-testid="pending-card"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-semibold">{{ row.name }}</h3>
            <p class="text-sm text-muted-foreground">
              {{ row.detail }}
            </p>
          </div>
          <p class="text-lg font-semibold tabular-nums">{{ formatINR(row.outstanding) }}</p>
        </div>
        <dl class="mt-3 space-y-1.5 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Overdue</dt>
            <dd
              class="tabular-nums"
              :class="row.late ? 'font-semibold text-destructive' : 'text-muted-foreground'"
            >
              {{ row.late ? formatINR(row.overdue) : '—' }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Oldest unpaid due</dt>
            <dd>{{ row.oldestDue }}</dd>
          </div>
        </dl>
        <Button
          variant="outline"
          class="mt-4 h-11 w-full"
          :aria-label="`View the unpaid bills of ${row.who}`"
          @click="emit('view', row.tenantId)"
        >
          View bills
        </Button>
      </li>
    </ul>
  </div>
</template>
