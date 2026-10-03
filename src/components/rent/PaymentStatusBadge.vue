<script setup lang="ts">
import { computed } from 'vue'

import type { PaymentStatus } from '@/types/rentEntry'
import { formatPaymentStatus } from '@/utils/rentCalculations'

const props = defineProps<{
  status: PaymentStatus
}>()

const STATUS_CLASSES: Record<PaymentStatus, string> = {
  paid: 'bg-success/10 text-success',
  partially_paid: 'bg-warning/10 text-warning',
  unpaid: 'bg-destructive/10 text-destructive',
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
