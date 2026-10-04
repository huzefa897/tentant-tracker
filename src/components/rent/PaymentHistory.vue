<script setup lang="ts">
import type { Payment } from '@/types/payment'
import { formatINR } from '@/utils/currency'
import { formatDateValue } from '@/utils/date'

// Shown in the given order; the page sorts them.
defineProps<{
  payments: Payment[]
}>()
</script>

<template>
  <p v-if="payments.length === 0" class="text-sm text-muted-foreground">
    No payments recorded for this entry.
  </p>

  <div v-else class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="text-left text-muted-foreground">
        <tr>
          <th scope="col" class="py-2 pr-4 font-medium">Paid date</th>
          <th scope="col" class="py-2 pr-4 text-right font-medium">Amount</th>
          <th scope="col" class="w-full py-2 font-medium">Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="payment in payments"
          :key="payment.id"
          class="border-t align-top"
          data-testid="payment-row"
        >
          <td class="py-2.5 pr-4 whitespace-nowrap">{{ formatDateValue(payment.paidDate) }}</td>
          <td class="py-2.5 pr-4 text-right font-medium whitespace-nowrap tabular-nums">
            {{ formatINR(payment.amount) }}
          </td>
          <!-- Text interpolation, never v-html: notes are user input. -->
          <td class="py-2.5 break-words whitespace-pre-wrap text-muted-foreground">
            {{ payment.notes.trim() ? payment.notes : '—' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
