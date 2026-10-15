<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, Plus } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { MissingBillTenancy, MissingBills } from '@/types/dashboard'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'

// Occupied flats with no bill for one month. Nothing is estimated for them: they're listed so
// an incomplete ledger never looks settled, and each can have its bill created from here.
const props = defineProps<{
  missing: MissingBills
}>()

const emit = defineEmits<{
  create: [tenantId: string, billingMonth: string]
}>()

const month = computed(() => formatMonthValue(props.missing.billingMonth))

// "Flat 102 · rent ₹14,000 · Ended tenancy"
function detail(tenancy: MissingBillTenancy) {
  return [
    `Flat ${tenancy.flatNumber}`,
    `rent ${formatINR(tenancy.rentAmount)}`,
    tenancy.tenancyStatus === 'ended' ? 'Ended tenancy' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <div>
    <ul v-if="missing.tenancies.length" class="divide-y rounded-xl border">
      <li
        v-for="tenancy in missing.tenancies"
        :key="tenancy.tenantId"
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
        data-testid="missing-row"
      >
        <div class="min-w-0">
          <p class="font-medium">{{ tenancy.name }}</p>
          <p class="text-sm text-muted-foreground">
            {{ detail(tenancy) }}
          </p>
        </div>
        <Button
          variant="outline"
          class="h-10"
          :aria-label="`Create the ${month} bill for ${tenancy.name}, Flat ${tenancy.flatNumber}`"
          @click="emit('create', tenancy.tenantId, missing.billingMonth)"
        >
          <Plus aria-hidden="true" />
          Create bill
        </Button>
      </li>
    </ul>
    <p
      v-else
      class="flex items-center gap-2 rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground"
      data-testid="missing-none"
    >
      <CircleCheck class="size-4 shrink-0 text-success" aria-hidden="true" />
      Every occupied flat has a bill for {{ month }}.
    </p>
  </div>
</template>
