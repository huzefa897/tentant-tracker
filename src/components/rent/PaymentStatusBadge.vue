<script setup lang="ts">
import { computed } from 'vue'

import type { PaymentStatus } from '@/types/rentEntry'
import { formatPaymentStatus } from '@/utils/rentCalculations'

const props = defineProps<{
  status: PaymentStatus
}>()

// Neutral, in words: how much is paid isn't how late it is. Lateness takes the colour, from
// DueStatusBadge beside it, so an unpaid bill that isn't due yet never looks overdue. A paid
// bill is the quietest.
const STATUS_CLASSES: Record<PaymentStatus, string> = {
  paid: 'bg-muted text-muted-foreground',
  partially_paid: 'bg-muted text-foreground',
  unpaid: 'bg-muted text-foreground',
}

const classes = computed(() => STATUS_CLASSES[props.status])
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium"
    :class="classes"
  >
    <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
    {{ formatPaymentStatus(status) }}
  </span>
</template>
