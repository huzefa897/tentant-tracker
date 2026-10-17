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
    No payments recorded for this bill.
  </p>

  <!-- A table from sm up; on phones each payment reflows into a short block (date and amount,
       then notes, then its buttons). The roles keep it a table for screen readers either way. -->
  <div v-else>
    <div class="sm:overflow-x-auto">
      <table class="w-full text-sm max-sm:block" role="table">
        <thead class="text-left text-muted-foreground max-sm:sr-only" role="rowgroup">
          <tr role="row">
            <th scope="col" class="py-2 pr-4 font-medium" role="columnheader">Paid date</th>
            <th scope="col" class="py-2 pr-4 text-right font-medium" role="columnheader">Amount</th>
            <th scope="col" class="w-full py-2 pr-4 font-medium" role="columnheader">Notes</th>
            <th
              v-if="hasActions"
              scope="col"
              class="py-2 text-right font-medium"
              role="columnheader"
            >
              {{ canReverse ? 'Actions' : 'Receipt' }}
            </th>
          </tr>
        </thead>
        <tbody class="max-sm:block" role="rowgroup">
          <tr
            v-for="payment in payments"
            :key="payment.id"
            class="border-t align-top max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-4 max-sm:py-3 max-sm:first:border-t-0 max-sm:first:pt-0"
            role="row"
            :class="{ 'text-muted-foreground': payment.status === 'reversed' }"
            :data-status="payment.status"
            data-testid="payment-row"
          >
            <td class="py-2.5 pr-4 whitespace-nowrap max-sm:py-0" role="cell">
              {{ formatDateValue(payment.paidDate) }}
            </td>
            <td
              class="py-2.5 pr-4 text-right font-medium whitespace-nowrap tabular-nums max-sm:py-0 max-sm:pr-0"
              role="cell"
            >
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
            <td
              class="py-2.5 pr-4 break-words whitespace-pre-wrap text-muted-foreground max-sm:col-span-2 max-sm:py-1 max-sm:pr-0"
              role="cell"
            >
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
            <td
              v-if="hasActions"
              class="py-1.5 text-right whitespace-nowrap max-sm:col-span-2 max-sm:pt-2 max-sm:pb-0"
              role="cell"
            >
              <div class="flex flex-wrap justify-end gap-2 max-sm:justify-start">
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
