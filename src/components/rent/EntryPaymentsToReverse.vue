<script setup lang="ts">
import { CircleAlert } from '@lucide/vue'

import type { Payment } from '@/types/payment'
import { formatINR } from '@/utils/currency'
import { formatDateValue } from '@/utils/date'

// The bill's payments that still count, which must be reversed (from its payment history)
// before it's voided or corrected. Nothing is moved automatically, and reversing refunds
// nothing: it corrects the records.
defineProps<{
  payments: Payment[]
  // What the bill can't be until then.
  action: 'voided' | 'corrected'
}>()
</script>

<template>
  <div
    class="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    role="alert"
    data-testid="payments-to-reverse"
  >
    <p class="flex gap-2 font-medium">
      <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      Reverse
      {{ payments.length === 1 ? 'this payment' : `these ${payments.length} payments` }} first. A
      bill with payments that count can't be {{ action }}.
    </p>
    <ul class="divide-y rounded-md border bg-background">
      <li
        v-for="payment in payments"
        :key="payment.id"
        class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2"
        data-testid="payment-to-reverse"
      >
        <span>{{ formatDateValue(payment.paidDate) }}</span>
        <span class="font-semibold tabular-nums">{{ formatINR(payment.amount) }}</span>
        <span v-if="payment.receipt" class="w-full text-xs text-muted-foreground break-all">
          Receipt {{ payment.receipt.reference }} will be marked VOID.
        </span>
      </li>
    </ul>
    <p class="text-muted-foreground">
      Use Reverse on each one in the payment history. Afterwards, record the payments again against
      the right bill. Reversing refunds nothing: it only corrects the records.
    </p>
  </div>
</template>
