<script setup lang="ts">
import { computed } from 'vue'

import PeriodStatusBadge from '@/components/dashboard/PeriodStatusBadge.vue'
import { Button } from '@/components/ui/button'
import type { RentalPeriodRow } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatDateValue, formatMonthValue } from '@/utils/date'

// Months of rent still owed, in the backend's order (oldest due first): one row per tenancy and
// month, its bill prepared or not. On a laptop one Outstanding column holds what's left to pay
// (and "of ₹15,750" once part is paid); a month without a bill says "Bill not prepared" there,
// never ₹0. Each row offers only the actions the backend says the viewer may take.
const props = withDefaults(
  defineProps<{
    periods: RentalPeriodRow[]
    // Today at the property (the summary's asOfDate), for "Due in 3 days".
    asOfDate: string
    // Read out before the table: which months it lists.
    caption?: string
  }>(),
  { caption: 'Rental months, oldest due first' },
)

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
      ended: period.tenancyStatus === 'ended',
      due: formatDateValue(period.dueDate),
      prepared: period.preparation === 'prepared',
      partlyPaid: period.preparation === 'prepared' && period.outstanding !== period.totalDue,
      can: (action: RentalPeriodRow['actions'][number]) => period.actions.includes(action),
      // For buttons read out of context: "Prepare bill: September 2026 · Shaik Zahid Ali · Flat 202".
      subject: `${month} · ${period.name} · Flat ${period.flatNumber}`,
    }
  }),
)
</script>

<template>
  <div>
    <!-- Desktop -->
    <div class="hidden overflow-x-auto lg:block">
      <table class="w-full text-sm">
        <caption class="sr-only">
          {{
            caption
          }}
        </caption>
        <thead class="bg-muted/40 text-left whitespace-nowrap text-muted-foreground">
          <tr>
            <th scope="col" class="px-4 py-2 font-medium">Tenant</th>
            <th scope="col" class="px-3 py-2 font-medium">Flat</th>
            <th scope="col" class="px-3 py-2 font-medium">Month</th>
            <th scope="col" class="px-3 py-2 font-medium">Due date</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">Outstanding</th>
            <th scope="col" class="px-3 py-2 font-medium">Status</th>
            <th scope="col" class="px-4 py-2"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.period.id" class="border-t" data-testid="period-row">
            <th scope="row" class="px-4 py-2 text-left font-medium whitespace-nowrap">
              {{ row.period.name }}
              <span v-if="row.ended" class="block text-sm font-normal text-muted-foreground"
                >Ended tenancy</span
              >
            </th>
            <td class="px-3 py-2 whitespace-nowrap">{{ row.period.flatNumber }}</td>
            <td class="px-3 py-2 whitespace-nowrap">{{ row.month }}</td>
            <td class="px-3 py-2 whitespace-nowrap">{{ row.due }}</td>
            <td
              v-if="row.prepared"
              class="px-3 py-2 text-right whitespace-nowrap tabular-nums"
              data-testid="period-outstanding"
            >
              <span class="font-semibold">{{ formatINR(row.period.outstanding!) }}</span
              ><template v-if="row.partlyPaid"
                >{{ ' '
                }}<span class="block text-sm text-muted-foreground">{{
                  `of ${formatINR(row.period.totalDue!)}`
                }}</span></template
              >
            </td>
            <td v-else class="px-3 py-2 text-right whitespace-nowrap">
              <span
                class="rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground"
                data-testid="awaiting-bill"
                >Bill not prepared</span
              >
            </td>
            <td class="px-3 py-2">
              <PeriodStatusBadge :period="row.period" :as-of-date="asOfDate" />
            </td>
            <td class="px-4 py-1.5">
              <div class="flex justify-end gap-1">
                <Button
                  v-if="row.can('prepare_bill')"
                  variant="outline"
                  class="h-9"
                  :aria-label="`Prepare bill: ${row.subject}`"
                  @click="emit('prepare', row.period)"
                >
                  Prepare bill
                </Button>
                <Button
                  v-if="row.can('mark_not_owed')"
                  variant="ghost"
                  class="h-9"
                  :aria-label="`Mark not owed: ${row.subject}`"
                  @click="emit('notOwed', row.period)"
                >
                  Not owed
                </Button>
                <Button
                  v-if="row.can('record_payment')"
                  variant="outline"
                  class="h-9"
                  :aria-label="`Record payment: ${row.subject}`"
                  @click="emit('record', row.period)"
                >
                  Record payment
                </Button>
                <Button
                  v-if="row.can('view_bill')"
                  variant="ghost"
                  class="h-9"
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
    <ul class="divide-y lg:hidden" :aria-label="caption">
      <li
        v-for="row in rows"
        :key="row.period.id"
        class="px-3 py-3 sm:px-4"
        data-testid="period-card"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="font-semibold">{{ row.period.name }}</h3>
            <p class="text-sm text-muted-foreground">
              Flat {{ row.period.flatNumber }}<template v-if="row.ended"> · Ended tenancy</template>
            </p>
          </div>
          <PeriodStatusBadge :period="row.period" :as-of-date="asOfDate" />
        </div>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <div>
            <dt class="text-muted-foreground">Month</dt>
            <dd>{{ row.month }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground">Due date</dt>
            <dd>{{ row.due }}</dd>
          </div>
          <template v-if="row.prepared">
            <div>
              <dt class="text-muted-foreground">Amount due</dt>
              <dd class="tabular-nums">{{ formatINR(row.period.totalDue!) }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Outstanding</dt>
              <dd class="text-base font-semibold tabular-nums">
                {{ formatINR(row.period.outstanding!) }}
              </dd>
            </div>
          </template>
          <div v-else class="col-span-2">
            <dt class="text-muted-foreground">Amount</dt>
            <dd class="text-muted-foreground">Bill not prepared</dd>
          </div>
        </dl>
        <div
          v-if="row.period.actions.length"
          class="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
        >
          <Button
            v-if="row.can('prepare_bill')"
            class="h-10"
            :aria-label="`Prepare bill: ${row.subject}`"
            @click="emit('prepare', row.period)"
          >
            Prepare bill
          </Button>
          <Button
            v-if="row.can('mark_not_owed')"
            variant="outline"
            class="h-10"
            :aria-label="`Mark not owed: ${row.subject}`"
            @click="emit('notOwed', row.period)"
          >
            Not owed
          </Button>
          <Button
            v-if="row.can('record_payment')"
            class="h-10"
            :aria-label="`Record payment: ${row.subject}`"
            @click="emit('record', row.period)"
          >
            Record payment
          </Button>
          <Button
            v-if="row.can('view_bill')"
            variant="outline"
            class="h-10"
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
