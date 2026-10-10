<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { TriangleAlert } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Payment } from '@/types/payment'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatDateValue, formatMonthValue } from '@/utils/date'
import { REVERSAL_REASON_MAX_LENGTH, validateReversalReason } from '@/utils/paymentValidation'

// Confirms reversing a payment recorded by mistake: what it is, why, and what reversing does.
// The page reverses it (the backend checks the owner's role and records who did it).
const props = defineProps<{
  tenant: Pick<Tenant, 'name' | 'flatNumber'>
  billingMonth: string
  payment: Payment
  saving?: boolean
  saveError?: string | null
}>()

const emit = defineEmits<{
  reverse: [reason: string]
  cancel: []
}>()

const reason = ref('')
const touched = ref(false)
const error = computed(() => (touched.value ? validateReversalReason(reason.value) : null))

const formRef = useTemplateRef<HTMLFormElement>('form')

async function handleSubmit() {
  if (props.saving) return
  touched.value = true
  if (validateReversalReason(reason.value)) {
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('#reversal-reason')?.focus()
    return
  }
  emit('reverse', reason.value.trim())
}
</script>

<template>
  <form ref="form" class="space-y-5" novalidate @submit.prevent="handleSubmit">
    <dl
      class="space-y-1.5 rounded-xl border bg-muted/40 p-4 text-sm"
      data-testid="reversal-payment"
    >
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Tenant</dt>
        <dd class="text-right font-medium">{{ tenant.name }} · Flat {{ tenant.flatNumber }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Billing month</dt>
        <dd class="font-medium">{{ formatMonthValue(billingMonth) }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Paid date</dt>
        <dd class="font-medium">{{ formatDateValue(payment.paidDate) }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Amount</dt>
        <dd class="font-semibold tabular-nums">{{ formatINR(payment.amount) }}</dd>
      </div>
    </dl>

    <div
      class="flex gap-3 rounded-lg bg-warning/10 p-3 text-sm text-foreground"
      data-testid="reversal-effects"
    >
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <ul class="space-y-1">
        <li>
          It stops counting towards this bill. It stays in the payment history, marked reversed.
        </li>
        <li v-if="payment.receipt">
          Its receipt
          <span class="font-medium break-all">{{ payment.receipt.reference }}</span> will be marked
          <strong>VOID</strong>. Copies already shared can't be recalled.
        </li>
        <li>No money is refunded: this only corrects the record.</li>
      </ul>
    </div>

    <fieldset class="min-w-0 space-y-2" :disabled="saving" data-testid="fields">
      <div class="flex items-baseline justify-between gap-2">
        <Label for="reversal-reason">Reason for reversing</Label>
        <span class="text-xs text-muted-foreground">
          {{ reason.length }}/{{ REVERSAL_REASON_MAX_LENGTH }}
        </span>
      </div>
      <Textarea
        id="reversal-reason"
        v-model="reason"
        :maxlength="REVERSAL_REASON_MAX_LENGTH"
        placeholder="e.g. Entered ₹10,000 instead of ₹1,000"
        class="bg-background"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? 'reversal-reason-error' : undefined"
        @blur="touched = true"
      />
      <p v-if="error" id="reversal-reason-error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>
    </fieldset>

    <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button type="submit" variant="destructive" class="h-11 sm:order-last" :disabled="saving">
        {{ saving ? 'Reversing…' : 'Reverse payment' }}
      </Button>
      <Button
        type="button"
        variant="secondary"
        class="h-11"
        :disabled="saving"
        @click="emit('cancel')"
      >
        Cancel
      </Button>
    </div>
  </form>
</template>
