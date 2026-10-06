<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef } from 'vue'
import { IndianRupee } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { PaymentInput } from '@/types/payment'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatMonthValue, toDateValue } from '@/utils/date'
import { hasAtMostTwoDecimals, toPaise } from '@/utils/money'
import {
  type PaymentDraft,
  parsePaymentDraft,
  validatePaymentDraft,
} from '@/utils/paymentValidation'
import { calculateOutstanding } from '@/utils/rentCalculations'
import { NOTES_MAX_LENGTH, type NumberInputValue, toAmount } from '@/utils/rentEntryValidation'

const props = defineProps<{
  tenant: Tenant
  entryId: string
  billingMonth: string
  // Current outstanding for the bill, from the backend. Only a preview: the backend checks
  // again, with the bill locked, when saving.
  outstanding: number
  saving?: boolean
  saveError?: string | null
}>()

// The page sends the payment with its idempotency key (it keeps the key across a retry).
const emit = defineEmits<{
  save: [input: PaymentInput]
  cancel: []
}>()

const PLACEHOLDER = '—'

// Local calendar date (not UTC), read once: the default and the "future" limit.
const today = toDateValue(new Date())

// The draft stays local; the store only receives it once Save is clicked and it's valid.
const amount = ref<NumberInputValue>('')
const paidDate = ref(today)
const notes = ref('')

const draft = computed<PaymentDraft>(() => ({
  amount: amount.value,
  paidDate: paidDate.value,
  notes: notes.value,
}))

const rules = computed(() => ({ today, outstanding: props.outstanding }))
const errors = computed(() => validatePaymentDraft(draft.value, rules.value))

// Preview. An empty or invalid amount shows "—" rather than a wrong balance.
const newPayment = computed(() => {
  const value = toAmount(amount.value)
  return value !== null && value > 0 && hasAtMostTwoDecimals(value) ? value : null
})
const exceedsOutstanding = computed(
  () => newPayment.value !== null && toPaise(newPayment.value) > toPaise(props.outstanding),
)
const remaining = computed(() =>
  newPayment.value !== null && !exceedsOutstanding.value
    ? calculateOutstanding(props.outstanding, newPayment.value)
    : null,
)

function formatAmount(value: number | null): string {
  return value === null ? PLACEHOLDER : formatINR(value)
}

// Errors appear once a field has been left or Save is clicked; paying too much shows at once.
const touched = reactive<Partial<Record<keyof PaymentDraft, boolean>>>({})
const submitted = ref(false)

function errorFor(field: keyof PaymentDraft): string | undefined {
  const visible =
    submitted.value || touched[field] || (field === 'amount' && exceedsOutstanding.value)
  return visible ? errors.value[field] : undefined
}

function fieldAttrs(field: keyof PaymentDraft) {
  const error = errorFor(field)
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `payment-${field}-error` : undefined,
    onBlur: () => (touched[field] = true),
  }
}

const formRef = useTemplateRef<HTMLFormElement>('form')

async function handleSubmit() {
  // Repeated clicks while a save is in progress do nothing.
  if (props.saving) return

  submitted.value = true

  const result = parsePaymentDraft(props.entryId, draft.value, rules.value)

  if (!result.ok) {
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }

  emit('save', result.input)
}

const inputClass = 'h-11 bg-background'
</script>

<template>
  <form ref="form" class="space-y-5" novalidate @submit.prevent="handleSubmit">
    <dl class="space-y-1.5 rounded-xl border bg-muted/40 p-4 text-sm" data-testid="payment-bill">
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Tenant</dt>
        <dd class="text-right font-medium">{{ tenant.name }} · Flat {{ tenant.flatNumber }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Billing month</dt>
        <dd class="font-medium">{{ formatMonthValue(billingMonth) }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Outstanding</dt>
        <dd class="font-semibold tabular-nums">{{ formatINR(outstanding) }}</dd>
      </div>
    </dl>

    <div class="space-y-2">
      <Label for="payment-amount">Amount received (₹)</Label>
      <div class="relative">
        <IndianRupee
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="payment-amount"
          v-model.number="amount"
          type="number"
          inputmode="decimal"
          min="0.01"
          step="0.01"
          required
          :class="[inputClass, 'pl-9']"
          v-bind="fieldAttrs('amount')"
        />
      </div>
      <p
        v-if="errorFor('amount')"
        id="payment-amount-error"
        class="text-sm text-destructive"
        role="alert"
      >
        {{ errorFor('amount') }}
      </p>
    </div>

    <div class="space-y-2">
      <Label for="payment-paidDate">Paid date</Label>
      <Input
        id="payment-paidDate"
        v-model="paidDate"
        type="date"
        :max="today"
        required
        :class="inputClass"
        v-bind="fieldAttrs('paidDate')"
      />
      <p
        v-if="errorFor('paidDate')"
        id="payment-paidDate-error"
        class="text-sm text-destructive"
        role="alert"
      >
        {{ errorFor('paidDate') }}
      </p>
    </div>

    <div class="space-y-2">
      <div class="flex items-baseline justify-between gap-2">
        <Label for="payment-notes">
          Notes <span class="text-muted-foreground">(optional)</span>
        </Label>
        <span class="text-xs text-muted-foreground">
          {{ notes.length }}/{{ NOTES_MAX_LENGTH }}
        </span>
      </div>
      <Textarea
        id="payment-notes"
        v-model="notes"
        :maxlength="NOTES_MAX_LENGTH"
        placeholder="e.g. Bank transfer"
        class="bg-background"
        v-bind="fieldAttrs('notes')"
      />
      <p
        v-if="errorFor('notes')"
        id="payment-notes-error"
        class="text-sm text-destructive"
        role="alert"
      >
        {{ errorFor('notes') }}
      </p>
    </div>

    <dl class="space-y-1.5 text-sm" data-testid="payment-preview">
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Current outstanding</dt>
        <dd class="tabular-nums">{{ formatINR(outstanding) }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">New payment</dt>
        <dd class="tabular-nums" data-testid="preview-payment">{{ formatAmount(newPayment) }}</dd>
      </div>
      <div class="flex justify-between gap-4 border-t pt-2 text-base font-semibold">
        <dt>Remaining after payment</dt>
        <dd class="tabular-nums" data-testid="preview-remaining">{{ formatAmount(remaining) }}</dd>
      </div>
    </dl>

    <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button type="submit" class="h-11 sm:order-last" :disabled="saving">
        {{ saving ? 'Saving…' : 'Save Payment' }}
      </Button>
      <Button type="button" variant="secondary" class="h-11" @click="emit('cancel')">
        Cancel
      </Button>
    </div>
  </form>
</template>
