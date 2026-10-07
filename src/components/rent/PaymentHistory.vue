<script setup lang="ts">
import { Download, ReceiptIndianRupee } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { Payment } from '@/types/payment'
import { formatINR } from '@/utils/currency'
import { formatDateValue } from '@/utils/date'

// Shown in the given order (the backend's: newest paid date first).
defineProps<{
  payments: Payment[]
  // Whether to offer receipts: "Issue receipt" for a payment without one, "Download receipt"
  // once it has one.
  receipts?: boolean
  // The payment whose receipt is being prepared; every button waits until it's done.
  downloadingPaymentId?: string | null
}>()

const emit = defineEmits<{
  // Issues the receipt if the payment has none, then downloads it as a PDF.
  'download-receipt': [paymentId: string]
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
          <th scope="col" class="w-full py-2 pr-4 font-medium">Notes</th>
          <th v-if="receipts" scope="col" class="py-2 text-right font-medium">Receipt</th>
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
          <td v-if="receipts" class="py-1.5 text-right whitespace-nowrap">
            <Button
              variant="outline"
              size="sm"
              class="h-9"
              :disabled="!!downloadingPaymentId"
              data-testid="download-receipt"
              @click="emit('download-receipt', payment.id)"
            >
              <Download v-if="payment.receipt" aria-hidden="true" />
              <ReceiptIndianRupee v-else aria-hidden="true" />
              {{
                downloadingPaymentId === payment.id
                  ? 'Preparing…'
                  : payment.receipt
                    ? 'Download receipt'
                    : 'Issue receipt'
              }}
            </Button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
