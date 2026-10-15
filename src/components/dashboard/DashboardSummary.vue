<script setup lang="ts">
import { computed } from 'vue'

import type { DashboardSummary } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'

// The property's totals from recorded bills: what's outstanding, then the parts of it that
// are late or due soon. Written as a breakdown of one figure, never as amounts to add up. Only
// late money takes colour.
const props = defineProps<{
  summary: DashboardSummary
}>()

function tenants(count: number) {
  return count === 1 ? '1 tenant' : `${count} tenants`
}

const owedBy = computed(() =>
  props.summary.pendingTenancyCount === 0
    ? 'Nothing is owed on recorded bills.'
    : `Owed by ${tenants(props.summary.pendingTenancyCount)}, on recorded bills.`,
)

const parts = computed(() => [
  {
    id: 'overdue',
    label: 'Overdue',
    amount: props.summary.overdue,
    note:
      props.summary.overdueTenancyCount > 0
        ? tenants(props.summary.overdueTenancyCount)
        : 'Nothing late',
    late: props.summary.overdue > 0,
    soon: false,
  },
  {
    id: 'due-today',
    label: 'Due today',
    amount: props.summary.dueToday,
    note: null,
    late: false,
    soon: props.summary.dueToday > 0,
  },
  {
    id: 'due-soon',
    label: 'Due in the next 7 days',
    amount: props.summary.dueNext7Days,
    note: null,
    late: false,
    soon: false,
  },
])
</script>

<template>
  <section
    class="rounded-2xl border bg-card p-5 sm:p-6"
    aria-labelledby="outstanding-heading"
    data-testid="dashboard-summary"
  >
    <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-end">
      <div>
        <h2 id="outstanding-heading" class="text-sm font-medium text-muted-foreground">
          Outstanding
        </h2>
        <p
          class="mt-1 text-4xl font-bold tracking-tight tabular-nums"
          data-testid="summary-outstanding"
        >
          {{ formatINR(summary.outstanding) }}
        </p>
        <p class="mt-1.5 text-sm text-muted-foreground" data-testid="summary-owed-by">
          {{ owedBy }}
        </p>
      </div>

      <div>
        <p class="mb-2 text-sm text-muted-foreground">Of which</p>
        <dl class="grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div
            v-for="part in parts"
            :key="part.id"
            class="flex items-baseline justify-between gap-3 py-3 sm:block sm:px-4 sm:first:pl-0"
            :data-testid="`summary-${part.id}`"
          >
            <dt class="text-sm text-muted-foreground">{{ part.label }}</dt>
            <dd class="text-right sm:mt-1 sm:text-left">
              <span
                class="text-lg font-semibold tabular-nums"
                :class="{ 'text-destructive': part.late, 'text-warning': part.soon }"
              >
                {{ formatINR(part.amount) }}
              </span>
              <span v-if="part.note" class="block text-xs text-muted-foreground">
                {{ part.note }}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- Bills from before due dates are owed, but can't be called late or on time. -->
    <p
      v-if="summary.withoutDueDate > 0"
      class="mt-4 text-sm text-muted-foreground"
      data-testid="summary-without-due-date"
    >
      {{ formatINR(summary.withoutDueDate) }} of it is on bills without a due date, so it isn’t
      counted as overdue or due soon.
    </p>
  </section>
</template>
