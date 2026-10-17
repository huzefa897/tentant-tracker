<script setup lang="ts">
import { computed } from 'vue'

import { Button } from '@/components/ui/button'
import type { RentalPeriodRow } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatDateValue, formatMonthValue } from '@/utils/date'
import { formatPeriodTiming } from '@/utils/rentalPeriods'

// Months of rent still owed, in the backend's order (oldest due first): one row per tenancy and
// month, its bill prepared or not. A month without a bill shows "Awaiting calculation", never
// an amount. Each row offers only the actions the backend says the viewer may take.
const props = defineProps<{
  periods: RentalPeriodRow[]
  // Today at the property (the summary's asOfDate), for "Due in 3 days".
  asOfDate: string
}>()

const emit = defineEmits<{
  prepare: [period: RentalPeriodRow]
  view: [period: RentalPeriodRow]
  record: [period: RentalPeriodRow]
  notOwed: [period: RentalPeriodRow]
}>()

const rows = computed(() =>
  props.periods.map((period) => {
    const month = formatMonthValue(period.periodMonth)
    return {
      period,
      month,
      who: `${period.name} · Flat ${period.flatNumber}`,
      // "Flat 202 · Ended tenancy"
      detail: [
        `Flat ${period.flatNumber}`,
        period.tenancyStatus === 'ended' ? 'Ended tenancy' : null,
      ]
        .filter(Boolean)
        .join(' · '),
      due: formatDateValue(period.dueDate),
      timing: formatPeriodTiming(period.timing, period.daysOverdue, period.dueDate, props.asOfDate),
      timingClass:
        period.timing === 'overdue'
          ? 'font-semibold text-destructive'
          : period.timing === 'due_today'
            ? 'font-semibold text-warning'
            : 'text-muted-foreground',
      prepared: period.preparation === 'prepared',
      can: (action: RentalPeriodRow['actions'][number]) => period.actions.includes(action),
      // For buttons read out of context: "Prepare the September 2026 bill of Shaik Zahid Ali".
      subject: `${month} · ${period.name} · Flat ${period.flatNumber}`,
    }
  }),
)
</script>

<template>
  <div>
    <!-- Desktop -->
    <div class="hidden overflow-x-auto rounded-xl border lg:block">
      <table class="w-full text-sm">
        <thead class="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th scope="col" class="px-4 py-3 font-medium">Tenant</th>
            <th scope="col" class="px-4 py-3 font-medium">Month</th>
            <th scope="col" class="px-4 py-3 font-medium">Due</th>
            <th scope="col" class="px-4 py-3 font-medium">Status</th>
            <th scope="col" class="px-4 py-3 font-medium">Bill</th>
            <th scope="col" class="px-4 py-3 text-right font-medium">Outstanding</th>
            <th scope="col" class="px-4 py-3"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.period.id" class="border-t" data-testid="period-row">
            <th scope="row" class="px-4 py-3 text-left font-medium">
              <span class="block">{{ row.period.name }}</span>
              <span class="sr-only">, </span>
              <span class="block text-sm font-normal text-muted-foreground">{{ row.detail }}</span>
            </th>
            <td class="px-4 py-3 whitespace-nowrap">{{ row.month }}</td>
            <td class="px-4 py-3 whitespace-nowrap">{{ row.due }}</td>
            <td class="px-4 py-3 whitespace-nowrap" :class="row.timingClass">{{ row.timing }}</td>
            <td class="px-4 py-3 whitespace-nowrap">
              <span :class="row.prepared ? '' : 'text-muted-foreground'">
                {{ row.prepared ? 'Prepared' : 'Not prepared' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              <span v-if="row.period.outstanding !== null" class="font-semibold tabular-nums">
                {{ formatINR(row.period.outstanding) }}
              </span>
              <span v-else class="text-muted-foreground" data-testid="awaiting-calculation">
                Awaiting calculation
              </span>
            </td>
            <td class="px-4 py-2">
              <div class="flex justify-end gap-1">
                <Button
                  v-if="row.can('prepare_bill')"
                  variant="outline"
                  class="h-10"
                  :aria-label="`Prepare bill: ${row.subject}`"
                  @click="emit('prepare', row.period)"
                >
                  Prepare bill
                </Button>
                <Button
                  v-if="row.can('mark_not_owed')"
                  variant="ghost"
                  class="h-10"
                  :aria-label="`Mark not owed: ${row.subject}`"
                  @click="emit('notOwed', row.period)"
                >
                  Not owed
                </Button>
                <Button
                  v-if="row.can('record_payment')"
                  variant="outline"
                  class="h-10"
                  :aria-label="`Record payment: ${row.subject}`"
                  @click="emit('record', row.period)"
                >
                  Record payment
                </Button>
                <Button
                  v-if="row.can('view_bill')"
                  variant="ghost"
                  class="h-10"
                  :aria-label="`View bill: ${row.subject}`"
                  @click="emit('view', row.period)"
                >
                  View bill
                </Button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Phones and tablets -->
    <ul class="space-y-3 lg:hidden">
      <li
        v-for="row in rows"
        :key="row.period.id"
        class="rounded-xl border bg-card p-4"
        data-testid="period-card"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-semibold">{{ row.period.name }}</h3>
            <p class="text-sm text-muted-foreground">{{ row.detail }}</p>
          </div>
          <p class="text-right">
            <span v-if="row.period.outstanding !== null" class="text-lg font-semibold tabular-nums">
              {{ formatINR(row.period.outstanding) }}
            </span>
            <span v-else class="text-sm text-muted-foreground">Awaiting calculation</span>
          </p>
        </div>
        <dl class="mt-3 space-y-1.5 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Month</dt>
            <dd>{{ row.month }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Due</dt>
            <dd>
              {{ row.due }} · <span :class="row.timingClass">{{ row.timing }}</span>
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Bill</dt>
            <dd :class="row.prepared ? '' : 'text-muted-foreground'">
              {{ row.prepared ? 'Prepared' : 'Not prepared' }}
            </dd>
          </div>
        </dl>
        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <Button
            v-if="row.can('prepare_bill')"
            class="h-11"
            :aria-label="`Prepare bill: ${row.subject}`"
            @click="emit('prepare', row.period)"
          >
            Prepare bill
          </Button>
          <Button
            v-if="row.can('mark_not_owed')"
            variant="outline"
            class="h-11"
            :aria-label="`Mark not owed: ${row.subject}`"
            @click="emit('notOwed', row.period)"
          >
            Not owed
          </Button>
          <Button
            v-if="row.can('record_payment')"
            class="h-11"
            :aria-label="`Record payment: ${row.subject}`"
            @click="emit('record', row.period)"
          >
            Record payment
          </Button>
          <Button
            v-if="row.can('view_bill')"
            variant="outline"
            class="h-11"
            :aria-label="`View bill: ${row.subject}`"
            @click="emit('view', row.period)"
          >
            View bill
          </Button>
        </div>
      </li>
    </ul>
  </div>
</template>
