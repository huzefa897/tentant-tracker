<script setup lang="ts">
import { computed } from 'vue'
import { FileText, Receipt } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { Payment } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import { formatINR } from '@/utils/currency'
import { formatDateValue } from '@/utils/date'

// Shown in the given order; the page sorts them. `receipts` may include other entries' receipts.
const props = defineProps<{
  payments: Payment[]
  receipts: PaymentReceipt[]
  issuing?: boolean
}>()

const emit = defineEmits<{
  'issue-receipt': [paymentId: string]
  'view-receipt': [receipt: PaymentReceipt]
}>()

const receiptsByPayment = computed(
  () => new Map(props.receipts.map((receipt) => [receipt.paymentId, receipt])),
)
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
          <th scope="col" class="w-full py-2 pr-4 font-medium">Notes</th>
          <th scope="col" class="py-2 text-right font-medium">Receipt</th>
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
          <td class="py-2.5 pr-4 break-words whitespace-pre-wrap text-muted-foreground">
            {{ payment.notes.trim() ? payment.notes : '—' }}
          </td>
          <td class="py-1.5 text-right whitespace-nowrap">
            <Button
              v-if="receiptsByPayment.get(payment.id)"
              variant="outline"
              size="sm"
              class="h-9"
              data-testid="view-receipt"
              @click="emit('view-receipt', receiptsByPayment.get(payment.id)!)"
            >
              <FileText aria-hidden="true" />
              View receipt
            </Button>
            <Button
              v-else
              variant="outline"
              size="sm"
              class="h-9"
              :disabled="issuing"
              data-testid="issue-receipt"
              @click="emit('issue-receipt', payment.id)"
            >
              <Receipt aria-hidden="true" />
              Issue receipt
            </Button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
