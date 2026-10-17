<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { OverdueBill, OverdueTenant } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatDateValue, formatMonthValue } from '@/utils/date'
import { formatDaysOverdue, formatOverdueBillCount } from '@/utils/overdueBills'

// Overdue bills grouped by tenant, in the backend's order (the oldest overdue bill first). Each
// tenant shows who and where, how many bills and how much is outstanding, then every overdue
// month: due date, days overdue, total, paid and what's left. A bill opens its page; the
// tenant's name opens their bills.
const props = defineProps<{
  tenants: OverdueTenant[]
  // With more than one property, each tenant says which.
  showProperty: boolean
}>()

const emit = defineEmits<{
  viewBill: [tenant: OverdueTenant, bill: OverdueBill]
  viewTenant: [tenant: OverdueTenant]
}>()

const groups = computed(() =>
  props.tenants.map((tenant) => ({
    tenant,
    // "Saleem Towers · Flat 202 · Ended tenancy"
    where: [
      props.showProperty ? tenant.propertyName : null,
      `Flat ${tenant.flatNumber}`,
      tenant.tenancyStatus === 'ended' ? 'Ended tenancy' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    headingId: `overdue-tenant-${tenant.tenantId}`,
    bills: tenant.bills.map((bill) => ({
      bill,
      month: formatMonthValue(bill.billingMonth),
      due: formatDateValue(bill.dueDate),
      overdue: formatDaysOverdue(bill.daysOverdue),
    })),
  })),
)
</script>

<template>
  <ul class="space-y-4">
    <li
      v-for="group in groups"
      :key="group.tenant.tenantId"
      class="rounded-xl border bg-card"
      data-testid="overdue-tenant"
    >
      <section :aria-labelledby="group.headingId">
        <header
          class="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"
        >
          <div class="min-w-0">
            <h3 :id="group.headingId" class="text-lg font-semibold">
              <button
                type="button"
                class="rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                :aria-label="`All bills of ${group.tenant.name}, Flat ${group.tenant.flatNumber}`"
                data-testid="overdue-tenant-name"
                @click="emit('viewTenant', group.tenant)"
              >
                {{ group.tenant.name }}
              </button>
            </h3>
            <p class="text-sm text-muted-foreground">{{ group.where }}</p>
          </div>
          <div class="sm:text-right">
            <p class="text-xl font-semibold tabular-nums" data-testid="overdue-tenant-outstanding">
              {{ formatINR(group.tenant.outstanding) }}
            </p>
            <p class="text-sm font-medium text-destructive">
              {{ formatOverdueBillCount(group.tenant.overdueBillCount) }}
            </p>
          </div>
        </header>

        <!-- Laptops: one row per month. Fixed column widths, so the columns line up from one
             tenant's card to the next; only from lg up, where Total, Paid and Balance each have
             room for a large amount (narrower, they'd overlap). It scrolls rather than overlaps
             if a card is ever narrower than that. -->
        <div class="hidden overflow-x-auto lg:block" data-testid="overdue-bill-table">
          <table class="w-full table-fixed text-sm">
            <caption class="sr-only">
              {{
                `Overdue bills of ${group.tenant.name}`
              }}
            </caption>
            <colgroup>
              <col class="w-[22%]" />
              <col class="w-[22%]" />
              <col />
              <col />
              <col />
              <col class="w-32" />
            </colgroup>
            <thead class="text-left text-muted-foreground">
              <tr>
                <th scope="col" class="px-5 pt-3 pb-2 font-medium">Month</th>
                <th scope="col" class="px-3 pt-3 pb-2 font-medium">Due</th>
                <th scope="col" class="px-3 pt-3 pb-2 text-right font-medium">Total</th>
                <th scope="col" class="px-3 pt-3 pb-2 text-right font-medium">Paid</th>
                <th scope="col" class="px-3 pt-3 pb-2 text-right font-medium">Balance</th>
                <th scope="col" class="px-5 pt-3 pb-2"><span class="sr-only">Bill</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in group.bills"
                :key="row.bill.id"
                class="border-t first:border-t-0"
                data-testid="overdue-bill"
              >
                <th scope="row" class="px-5 py-2 text-left font-medium whitespace-nowrap">
                  {{ row.month }}
                </th>
                <td class="px-3 py-2 whitespace-nowrap">
                  {{ row.due }}
                  <span class="block text-xs font-semibold text-destructive">{{
                    row.overdue
                  }}</span>
                </td>
                <td class="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  {{ formatINR(row.bill.totalAmount) }}
                </td>
                <td
                  class="px-3 py-2 text-right whitespace-nowrap text-muted-foreground tabular-nums"
                >
                  {{ formatINR(row.bill.paidAmount) }}
                </td>
                <td class="px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums">
                  {{ formatINR(row.bill.outstanding) }}
                </td>
                <td class="px-5 py-1 text-right">
                  <Button
                    variant="ghost"
                    class="h-10"
                    :aria-label="`View bill: ${row.month} · ${group.tenant.name}`"
                    @click="emit('viewBill', group.tenant, row.bill)"
                  >
                    View bill
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Phones and tablets: each month is a button to its bill. -->
        <ul class="divide-y lg:hidden" data-testid="overdue-bill-items">
          <li v-for="row in group.bills" :key="row.bill.id" data-testid="overdue-bill-item">
            <button
              type="button"
              class="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              :aria-label="`View bill: ${row.month} · ${group.tenant.name}`"
              @click="emit('viewBill', group.tenant, row.bill)"
            >
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline justify-between gap-3">
                  <span class="font-medium">{{ row.month }}</span>
                  <span class="font-semibold tabular-nums">{{
                    formatINR(row.bill.outstanding)
                  }}</span>
                </span>
                <span class="mt-0.5 block text-sm">
                  <span class="font-semibold text-destructive">{{ row.overdue }}</span>
                  <span class="text-muted-foreground"> · due {{ row.due }}</span>
                </span>
                <span class="block text-sm text-muted-foreground tabular-nums">
                  {{ formatINR(row.bill.totalAmount) }} total ·
                  {{ formatINR(row.bill.paidAmount) }} paid
                </span>
              </span>
              <ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </section>
    </li>
  </ul>
</template>
