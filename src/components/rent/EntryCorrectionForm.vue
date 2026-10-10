<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef } from 'vue'
import { ArrowRight, TriangleAlert } from '@lucide/vue'

import EntryPaymentsToReverse from '@/components/rent/EntryPaymentsToReverse.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Payment } from '@/types/payment'
import type { EntryCorrectionInput, RentEntry } from '@/types/rentEntry'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'
import {
  NOTES_MAX_LENGTH,
  VOID_REASON_MAX_LENGTH,
  getDraftTotalDue,
  parseEntryCorrection,
  validateEntryCorrection,
  type EntryCorrectionDraft,
} from '@/utils/rentEntryValidation'

// Corrects a bill's charges: its original values beside editable replacement values (starting
// from the original's, never the tenant's current rent or rate), the reason, and both totals.
// The month and electricity rate stay the original's. A bill whose payments still count can't
// be corrected: they're listed, to reverse first. The page sends it; the backend voids the
// original and creates the replacement together.
const props = defineProps<{
  original: RentEntry
  // The bill's payments that still count (not reversed).
  paymentsToReverse: Payment[]
  saving?: boolean
  saveError?: string | null
}>()

const emit = defineEmits<{
  submit: [input: EntryCorrectionInput]
  cancel: []
}>()

type Field = 'rentAmount' | 'electricityUnits' | 'waterAmount' | 'notes' | 'reason'

const draft = reactive<EntryCorrectionDraft>({
  rentAmount: props.original.rentAmount,
  electricityUnits: props.original.electricityUnits,
  waterAmount: props.original.waterAmount,
  notes: props.original.notes,
  reason: '',
})

const submitted = ref(false)
const touched = reactive<Partial<Record<Field, boolean>>>({})
const errors = computed(() => validateEntryCorrection(props.original, draft))
const blocked = computed(() => props.paymentsToReverse.length > 0)

function errorFor(field: Field | 'unchanged'): string | undefined {
  if (field === 'unchanged') return submitted.value ? errors.value.unchanged : undefined
  return submitted.value || touched[field] ? errors.value[field] : undefined
}

function fieldAttrs(field: Field) {
  const error = errorFor(field)
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `correction-${field}-error` : undefined,
    onBlur: () => (touched[field] = true),
  }
}

// A preview by the backend's rule; the saved figures are the backend's.
const replacementTotal = computed(() =>
  getDraftTotalDue({
    billingMonth: props.original.billingMonth,
    rentAmount: draft.rentAmount,
    electricityUnits: draft.electricityUnits,
    electricityRate: props.original.electricityRate,
    waterAmount: draft.waterAmount,
    notes: draft.notes,
  }),
)

const chargeFields = [
  { field: 'rentAmount', label: 'Rent (₹)', original: () => formatINR(props.original.rentAmount) },
  {
    field: 'electricityUnits',
    label: 'Electricity units',
    original: () => String(props.original.electricityUnits),
  },
  {
    field: 'waterAmount',
    label: 'Water (₹)',
    original: () => formatINR(props.original.waterAmount),
  },
] as const

const formRef = useTemplateRef<HTMLFormElement>('form')

async function handleSubmit() {
  if (props.saving || blocked.value) return
  submitted.value = true
  const parsed = parseEntryCorrection(props.original, draft)
  if (!parsed.ok) {
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  emit('submit', parsed.input)
}

const inputClass = 'h-11 bg-background'
</script>

<template>
  <form ref="form" class="space-y-6" novalidate @submit.prevent="handleSubmit">
    <EntryPaymentsToReverse v-if="blocked" :payments="paymentsToReverse" action="corrected" />

    <fieldset class="min-w-0 space-y-6" :disabled="saving || blocked" data-testid="fields">
      <section aria-labelledby="correction-charges-heading" class="rounded-xl border p-4 sm:p-6">
        <h2 id="correction-charges-heading" class="mb-1 font-semibold">Charges</h2>
        <p class="mb-4 text-sm text-muted-foreground">
          {{ formatMonthValue(original.billingMonth) }} · Electricity rate
          {{ formatINR(original.electricityRate) }} / unit, as on the original bill.
        </p>

        <div class="space-y-4">
          <div v-for="item in chargeFields" :key="item.field" class="space-y-2">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4">
              <Label :for="`correction-${item.field}`">{{ item.label }}</Label>
              <span class="text-sm text-muted-foreground" data-testid="original-value">
                Original: <span class="tabular-nums">{{ item.original() }}</span>
              </span>
            </div>
            <Input
              :id="`correction-${item.field}`"
              v-model.number="draft[item.field]"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              required
              :class="inputClass"
              v-bind="fieldAttrs(item.field)"
            />
            <p
              v-if="errorFor(item.field)"
              :id="`correction-${item.field}-error`"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor(item.field) }}
            </p>
          </div>

          <div class="space-y-2">
            <div class="flex items-baseline justify-between gap-2">
              <Label for="correction-notes">Notes</Label>
              <span class="text-xs text-muted-foreground">
                {{ draft.notes.length }}/{{ NOTES_MAX_LENGTH }}
              </span>
            </div>
            <Textarea
              id="correction-notes"
              v-model="draft.notes"
              :maxlength="NOTES_MAX_LENGTH"
              class="bg-background"
              v-bind="fieldAttrs('notes')"
            />
            <p
              v-if="errorFor('notes')"
              id="correction-notes-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('notes') }}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="correction-totals-heading" class="rounded-xl border p-4 sm:p-6">
        <h2 id="correction-totals-heading" class="mb-3 font-semibold">Total due</h2>
        <dl class="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="correction-totals">
          <div>
            <dt class="text-xs text-muted-foreground">Original (becomes void)</dt>
            <dd class="text-lg font-semibold tabular-nums line-through decoration-1">
              {{ formatINR(original.totalDue) }}
            </dd>
          </div>
          <ArrowRight class="size-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <dt class="text-xs text-muted-foreground">Replacement</dt>
            <dd class="text-lg font-semibold tabular-nums" data-testid="replacement-total">
              {{ replacementTotal === null ? '—' : formatINR(replacementTotal) }}
            </dd>
          </div>
        </dl>
      </section>

      <div
        class="flex gap-3 rounded-lg bg-warning/10 p-3 text-sm text-foreground"
        data-testid="correction-effects"
      >
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <ul class="space-y-1">
          <li>
            The original stays in the history, marked <strong>VOID</strong>, and counts towards
            nothing.
          </li>
          <li>The replacement is a new bill for the same month, linked to the original.</li>
          <li>Record payments against the replacement afterwards: none are moved for you.</li>
        </ul>
      </div>

      <div class="space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <Label for="correction-reason">Reason for correcting</Label>
          <span class="text-xs text-muted-foreground">
            {{ draft.reason.length }}/{{ VOID_REASON_MAX_LENGTH }}
          </span>
        </div>
        <Textarea
          id="correction-reason"
          v-model="draft.reason"
          :maxlength="VOID_REASON_MAX_LENGTH"
          placeholder="e.g. Electricity units entered as 750 instead of 75"
          class="bg-background"
          v-bind="fieldAttrs('reason')"
        />
        <p
          v-if="errorFor('reason')"
          id="correction-reason-error"
          class="text-sm text-destructive"
          role="alert"
        >
          {{ errorFor('reason') }}
        </p>
      </div>
    </fieldset>

    <p v-if="errorFor('unchanged')" class="text-sm text-destructive" role="alert">
      {{ errorFor('unchanged') }}
    </p>
    <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button type="submit" class="h-11 sm:order-last" :disabled="saving || blocked">
        {{ saving ? 'Correcting…' : 'Correct bill' }}
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
