<script setup lang="ts">
import { computed } from 'vue'
import { Download, ReceiptIndianRupee, Undo2 } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { Payment } from '@/types/payment'
import { formatINR } from '@/utils/currency'
import { formatDateValue, formatTimestamp } from '@/utils/date'

// Shown in the given order (the backend's: newest paid date first). Reversed payments stay,
// marked, and don't count towards the bill.
const props = defineProps<{
  payments: Payment[]
  // Whether to offer receipts: "Issue receipt" for a payment without one, "Download receipt"
  // once it has one (marked void once its payment is reversed).
  receipts?: boolean
  // The payment whose receipt is being prepared; every button waits until it's done.
  downloadingPaymentId?: string | null
  // Whether to offer "Reverse" on payments that still count (owners only; the backend checks).
  canReverse?: boolean
}>()

const emit = defineEmits<{
  // Issues the receipt if the payment has none, then downloads it as a PDF.
  'download-receipt': [paymentId: string]
  'reverse-payment': [paymentId: string]
}>()

const hasActions = computed(() => props.receipts || props.canReverse)
const anyReversed = computed(() => props.payments.some((p) => p.status === 'reversed'))

function receiptLabel(payment: Payment): string {
  if (props.downloadingPaymentId === payment.id) return 'Preparing…'
  if (!payment.receipt) return 'Issue receipt'
  return payment.receipt.status === 'void' ? 'Download void receipt' : 'Download receipt'
}

function reversedBy(payment: Payment): string {
  const reversal = payment.reversal
  if (!reversal) return ''
  const who = reversal.createdByName ? ` by ${reversal.createdByName}` : ''
  return `Reversed${who} on ${formatTimestamp(reversal.createdAt)}`
}
</script>

<template>
  <p v-if="payments.length === 0" class="text-sm text-muted-foreground">
    No payments recorded for this entry.
  </p>

  <div v-else>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-muted-foreground">
          <tr>
            <th scope="col" class="py-2 pr-4 font-medium">Paid date</th>
            <th scope="col" class="py-2 pr-4 text-right font-medium">Amount</th>
            <th scope="col" class="w-full py-2 pr-4 font-medium">Notes</th>
            <th v-if="hasActions" scope="col" class="py-2 text-right font-medium">
              {{ canReverse ? 'Actions' : 'Receipt' }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="payment in payments"
            :key="payment.id"
            class="border-t align-top"
            :class="{ 'text-muted-foreground': payment.status === 'reversed' }"
            :data-status="payment.status"
            data-testid="payment-row"
          >
            <td class="py-2.5 pr-4 whitespace-nowrap">{{ formatDateValue(payment.paidDate) }}</td>
            <td class="py-2.5 pr-4 text-right font-medium whitespace-nowrap tabular-nums">
              <span :class="{ 'line-through': payment.status === 'reversed' }">
                {{ formatINR(payment.amount) }}
              </span>
              <span
                v-if="payment.status === 'reversed'"
                class="mt-1 block text-xs font-medium text-destructive no-underline"
                data-testid="reversed-badge"
              >
                Reversed
              </span>
            </td>
            <!-- Text interpolation, never v-html: notes and reasons are user input. -->
            <td class="py-2.5 pr-4 break-words whitespace-pre-wrap text-muted-foreground">
              {{ payment.notes.trim() ? payment.notes : '—' }}
              <p
                v-if="payment.reversal"
                class="mt-1.5 border-l-2 border-destructive/40 pl-2 text-xs"
                data-testid="reversal-reason"
              >
                <span class="font-medium text-foreground">{{ reversedBy(payment) }}:</span>
                {{ payment.reversal.reason }}
              </p>
            </td>
            <td v-if="hasActions" class="py-1.5 text-right whitespace-nowrap">
              <div class="flex justify-end gap-2">
                <!-- A reversed payment never gets a new receipt; one it had stays downloadable, void. -->
                <Button
                  v-if="receipts && (payment.status === 'recorded' || payment.receipt)"
                  variant="outline"
                  size="sm"
                  class="h-9"
                  :disabled="!!downloadingPaymentId"
                  data-testid="download-receipt"
                  @click="emit('download-receipt', payment.id)"
                >
                  <Download v-if="payment.receipt" aria-hidden="true" />
                  <ReceiptIndianRupee v-else aria-hidden="true" />
                  {{ receiptLabel(payment) }}
                </Button>
                <Button
                  v-if="canReverse && payment.status === 'recorded'"
                  variant="ghost"
                  size="sm"
                  class="h-9 text-destructive hover:text-destructive"
                  :aria-label="`Reverse the ${formatINR(payment.amount)} payment of ${formatDateValue(payment.paidDate)}`"
                  data-testid="reverse-payment"
                  @click="emit('reverse-payment', payment.id)"
                >
                  <Undo2 aria-hidden="true" />
                  Reverse
                </Button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="anyReversed" class="mt-3 text-xs text-muted-foreground" data-testid="reversed-note">
      Reversed payments are kept for the record and don't count towards Total paid.
    </p>
  </div>
</template>
