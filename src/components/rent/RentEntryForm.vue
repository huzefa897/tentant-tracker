<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue'
import { Droplet, IndianRupee, Lock, Zap } from '@lucide/vue'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { NewRentEntrySubmission } from '@/types/rentEntry'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { toDateValue, toMonthValue } from '@/utils/date'
import { toPaise } from '@/utils/money'
import { type PaymentDraft, validatePaymentDraft } from '@/utils/paymentValidation'
import {
  calculateElectricity,
  calculateOutstanding,
  getPaymentStatus,
} from '@/utils/rentCalculations'
import {
  getDraftTotalDue,
  NOTES_MAX_LENGTH,
  type NumberInputValue,
  parseRentEntryDraft,
  type RentEntryDraft,
  toAmount,
  validateRentEntryDraft,
} from '@/utils/rentEntryValidation'

const props = withDefaults(
  defineProps<{
    tenant: Tenant
    // Shown above the actions, e.g. a duplicate-entry error from the store.
    saveError?: string | null
    // While the page saves: every field, Save and Cancel are disabled, so one click sends one
    // request, nothing typed afterwards is lost when the confirmation replaces the form, and the
    // bill can't be discarded while it's being created.
    saving?: boolean
  }>(),
  { saveError: null, saving: false },
)

const emit = defineEmits<{
  save: [submission: NewRentEntrySubmission]
  cancel: []
  dirtyChange: [dirty: boolean]
}>()

const PLACEHOLDER = '—'

// Read once: the form is short-lived, and these are only defaults and the "future" limit.
const now = new Date()
const today = toDateValue(now)
const initialMonth = toMonthValue(now)

// The unfinished entry stays local; the store only receives it once Save succeeds.
const billingMonth = ref(initialMonth)
const rentAmount = ref<NumberInputValue>(props.tenant.rentAmount)
const electricityUnits = ref<NumberInputValue>('')
const waterAmount = ref<NumberInputValue>(0)
const notes = ref('')
// Optional payment received with the bill; 0 means nothing has been paid yet.
const paymentAmount = ref<NumberInputValue>(0)
const paidDate = ref('')
const paymentNotes = ref('')

const draft = computed<RentEntryDraft>(() => ({
  billingMonth: billingMonth.value,
  rentAmount: rentAmount.value,
  electricityUnits: electricityUnits.value,
  electricityRate: props.tenant.electricityRate,
  waterAmount: waterAmount.value,
  notes: notes.value,
}))

const paymentDraft = computed<PaymentDraft>(() => ({
  amount: paymentAmount.value,
  paidDate: paidDate.value,
  notes: paymentNotes.value,
}))

const isDirty = computed(
  () =>
    billingMonth.value !== initialMonth ||
    rentAmount.value !== props.tenant.rentAmount ||
    electricityUnits.value !== '' ||
    waterAmount.value !== 0 ||
    notes.value !== '' ||
    paymentAmount.value !== 0 ||
    paidDate.value !== '' ||
    paymentNotes.value !== '',
)

// The parent owns navigation, so it needs to know whether leaving would lose changes.
watch(isDirty, (dirty) => emit('dirtyChange', dirty))

// Live summary. Anything that can't be calculated yet shows "—" rather than a wrong amount.
const paidAmount = computed(() => {
  const amount = toAmount(paymentAmount.value)
  return amount !== null && amount >= 0 ? amount : null
})
const paymentRecorded = computed(() => paidAmount.value !== null && paidAmount.value > 0)

const electricityAmount = computed(() => {
  const units = toAmount(electricityUnits.value)
  return units !== null && units >= 0
    ? calculateElectricity(units, props.tenant.electricityRate)
    : null
})
const totalDue = computed(() => getDraftTotalDue(draft.value))
const outstanding = computed(() =>
  totalDue.value !== null &&
  paidAmount.value !== null &&
  toPaise(paidAmount.value) <= toPaise(totalDue.value)
    ? calculateOutstanding(totalDue.value, paidAmount.value)
    : null,
)
const paymentStatus = computed(() =>
  outstanding.value !== null ? getPaymentStatus(totalDue.value!, paidAmount.value!) : null,
)

function formatAmount(value: number | null): string {
  return value === null ? PLACEHOLDER : formatINR(value)
}

const summaryRows = computed(() => {
  const units = toAmount(electricityUnits.value)
  const rent = toAmount(rentAmount.value)
  const water = toAmount(waterAmount.value)

  return [
    { label: 'Rent', value: formatAmount(rent !== null && rent > 0 ? rent : null) },
    {
      label:
        units !== null && units >= 0
          ? `Electricity: ${units} × ${formatINR(props.tenant.electricityRate)}`
          : 'Electricity',
      value: formatAmount(electricityAmount.value),
    },
    { label: 'Water', value: formatAmount(water !== null && water >= 0 ? water : null) },
  ]
})

// Form fields by input id. The payment's own fields map to the payment rules.
type Field = keyof RentEntryDraft | 'paymentAmount' | 'paidDate' | 'paymentNotes'

// The initial payment may be up to the bill's total due; with no total yet it's unchecked here
// and checked once the charges are valid.
const entryErrors = computed(() => validateRentEntryDraft(draft.value))
const paymentErrors = computed(() =>
  validatePaymentDraft(paymentDraft.value, {
    today,
    outstanding: totalDue.value ?? undefined,
    allowZero: true,
  }),
)

const errors = computed<Partial<Record<Field, string>>>(() => ({
  ...entryErrors.value,
  paymentAmount: paymentErrors.value.amount,
  paidDate: paymentErrors.value.paidDate,
  paymentNotes: paymentErrors.value.notes,
}))

const hasErrors = computed(() => Object.values(errors.value).some(Boolean))

// Errors appear once a field has been left, or for every field after Save is clicked.
const touched = reactive<Partial<Record<Field, boolean>>>({})
const submitted = ref(false)

function errorFor(field: Field): string | undefined {
  return submitted.value || touched[field] ? errors.value[field] : undefined
}

function fieldAttrs(field: Field) {
  const error = errorFor(field)
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${field}-error` : undefined,
    onBlur: () => (touched[field] = true),
  }
}

const formRef = useTemplateRef<HTMLFormElement>('form')

async function handleSubmit() {
  if (props.saving) return
  submitted.value = true

  // Validate again here: the inputs alone can't be trusted to hold valid values.
  const entry = parseRentEntryDraft(props.tenant.id, draft.value)

  if (!entry.ok || hasErrors.value) {
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }

  // Validation guarantees a finite, non-negative amount; 0 means no payment.
  const amount = paymentAmount.value as number

  emit('save', {
    entry: { ...entry.input, useTenancyRent: rentAmount.value === props.tenant.rentAmount },
    initialPayment:
      amount > 0 ? { amount, paidDate: paidDate.value, notes: paymentNotes.value.trim() } : null,
  })
}

const sectionClass = 'space-y-4 rounded-xl border bg-muted/40 p-4 sm:p-5'
const inputClass = 'h-11 bg-background'
const lockedClass =
  'flex h-11 items-center justify-between rounded-lg border bg-muted px-3 text-base text-muted-foreground'
</script>

<template>
  <form
    ref="form"
    class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_22rem]"
    novalidate
    @submit.prevent="handleSubmit"
  >
    <fieldset class="min-w-0 space-y-5" :disabled="saving" data-testid="fields">
      <section :class="sectionClass" aria-labelledby="rent-details-heading">
        <div>
          <h2 id="rent-details-heading" class="font-semibold">Rent details</h2>
          <p class="text-sm text-muted-foreground">Billing month and rent for this entry.</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-2">
            <Label for="billingMonth">Billing month</Label>
            <Input
              id="billingMonth"
              v-model="billingMonth"
              type="month"
              required
              :class="inputClass"
              v-bind="fieldAttrs('billingMonth')"
            />
            <p
              v-if="errorFor('billingMonth')"
              id="billingMonth-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('billingMonth') }}
            </p>
          </div>

          <div class="space-y-2">
            <Label for="rentAmount">Rent amount (₹)</Label>
            <div class="relative">
              <IndianRupee
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="rentAmount"
                v-model.number="rentAmount"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                required
                :class="[inputClass, 'pl-9']"
                v-bind="fieldAttrs('rentAmount')"
              />
            </div>
            <p
              v-if="errorFor('rentAmount')"
              id="rentAmount-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('rentAmount') }}
            </p>
          </div>
        </div>
      </section>

      <section :class="sectionClass" aria-labelledby="utility-details-heading">
        <div>
          <h2 id="utility-details-heading" class="font-semibold">Utility details</h2>
          <p class="text-sm text-muted-foreground">
            Electricity used and water charges this month.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-2">
            <Label for="electricityUnits">Electricity units used</Label>
            <div class="relative">
              <Zap
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="electricityUnits"
                v-model.number="electricityUnits"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                required
                placeholder="e.g. 75"
                :class="[inputClass, 'pl-9']"
                v-bind="fieldAttrs('electricityUnits')"
              />
            </div>
            <p
              v-if="errorFor('electricityUnits')"
              id="electricityUnits-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('electricityUnits') }}
            </p>
          </div>

          <div class="space-y-2">
            <Label for="waterAmount">Water amount (₹)</Label>
            <div class="relative">
              <Droplet
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="waterAmount"
                v-model.number="waterAmount"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                required
                :class="[inputClass, 'pl-9']"
                v-bind="fieldAttrs('waterAmount')"
              />
            </div>
            <p
              v-if="errorFor('waterAmount')"
              id="waterAmount-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('waterAmount') }}
            </p>
          </div>

          <div class="space-y-2">
            <p id="electricityRate-label" class="text-sm font-medium">Electricity rate</p>
            <div :class="lockedClass" aria-labelledby="electricityRate-label" data-testid="rate">
              {{ formatINR(tenant.electricityRate) }} / unit
              <Lock class="size-4" aria-hidden="true" />
            </div>
            <p
              v-if="errorFor('electricityRate')"
              id="electricityRate-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('electricityRate') }}
            </p>
          </div>

          <div class="space-y-2">
            <p id="electricityAmount-label" class="text-sm font-medium">Electricity amount</p>
            <div
              :class="lockedClass"
              aria-labelledby="electricityAmount-label"
              data-testid="electricity-amount"
            >
              {{ formatAmount(electricityAmount) }}
              <Lock class="size-4" aria-hidden="true" />
            </div>
          </div>
        </div>
      </section>

      <section :class="sectionClass" aria-labelledby="payment-heading">
        <div>
          <h2 id="payment-heading" class="font-semibold">Payment</h2>
          <p class="text-sm text-muted-foreground">
            Record a payment received with this bill, or leave it at 0 if nothing has been paid yet.
            Later payments can be added from the entry's details.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-2">
            <Label for="paymentAmount">Amount paid (₹)</Label>
            <div class="relative">
              <IndianRupee
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="paymentAmount"
                v-model.number="paymentAmount"
                type="number"
                inputmode="decimal"
                min="0"
                step="0.01"
                required
                :class="[inputClass, 'pl-9']"
                v-bind="fieldAttrs('paymentAmount')"
              />
            </div>
            <p
              v-if="errorFor('paymentAmount')"
              id="paymentAmount-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('paymentAmount') }}
            </p>
          </div>

          <div class="space-y-2">
            <Label for="paidDate">Paid date</Label>
            <!-- Disabled and blank while nothing is paid; the typed date is kept in case it's re-enabled. -->
            <Input
              id="paidDate"
              type="date"
              :model-value="paymentRecorded ? paidDate : ''"
              :max="today"
              :disabled="!paymentRecorded"
              :required="paymentRecorded"
              :class="inputClass"
              v-bind="fieldAttrs('paidDate')"
              @update:model-value="paidDate = String($event)"
            />
            <p
              v-if="errorFor('paidDate')"
              id="paidDate-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('paidDate') }}
            </p>
            <p v-else-if="!paymentRecorded" class="text-xs text-muted-foreground">
              Enter an amount paid to set the date.
            </p>
          </div>
        </div>

        <div v-if="paymentRecorded" class="space-y-2">
          <div class="flex items-baseline justify-between gap-2">
            <Label for="paymentNotes">
              Payment notes <span class="text-muted-foreground">(optional)</span>
            </Label>
            <span class="text-xs text-muted-foreground">
              {{ paymentNotes.length }}/{{ NOTES_MAX_LENGTH }}
            </span>
          </div>
          <Input
            id="paymentNotes"
            v-model="paymentNotes"
            :maxlength="NOTES_MAX_LENGTH"
            placeholder="e.g. Paid via UPI"
            :class="inputClass"
            v-bind="fieldAttrs('paymentNotes')"
          />
          <p
            v-if="errorFor('paymentNotes')"
            id="paymentNotes-error"
            class="text-sm text-destructive"
            role="alert"
          >
            {{ errorFor('paymentNotes') }}
          </p>
        </div>
      </section>

      <section :class="sectionClass" aria-labelledby="notes-heading">
        <div class="flex items-baseline justify-between gap-2">
          <h2 id="notes-heading" class="font-semibold">
            <Label for="notes" class="text-base">
              Notes <span class="font-normal text-muted-foreground">(optional)</span>
            </Label>
          </h2>
          <span class="text-xs text-muted-foreground">
            {{ notes.length }}/{{ NOTES_MAX_LENGTH }}
          </span>
        </div>
        <Textarea
          id="notes"
          v-model="notes"
          :maxlength="NOTES_MAX_LENGTH"
          placeholder="e.g. Meter read on the 1st"
          class="bg-background"
          v-bind="fieldAttrs('notes')"
        />
        <p v-if="errorFor('notes')" id="notes-error" class="text-sm text-destructive" role="alert">
          {{ errorFor('notes') }}
        </p>
      </section>
    </fieldset>

    <div class="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <section
        class="rounded-xl border bg-card p-4 sm:p-5"
        aria-labelledby="summary-heading"
        data-testid="summary"
      >
        <h2 id="summary-heading" class="mb-3 font-semibold">Summary</h2>

        <dl class="space-y-2 text-sm">
          <div v-for="row in summaryRows" :key="row.label" class="flex justify-between gap-4">
            <dt class="text-muted-foreground">{{ row.label }}</dt>
            <dd class="font-medium tabular-nums">{{ row.value }}</dd>
          </div>

          <div class="flex justify-between gap-4 border-t pt-2 text-base">
            <dt class="font-semibold">Total due</dt>
            <dd class="font-semibold tabular-nums" data-testid="total-due">
              {{ formatAmount(totalDue) }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Total paid</dt>
            <dd class="font-medium tabular-nums">{{ formatAmount(paidAmount) }}</dd>
          </div>
          <div class="flex justify-between gap-4 border-t pt-2 text-base">
            <dt class="font-semibold">Outstanding</dt>
            <dd class="font-semibold tabular-nums" data-testid="outstanding">
              {{ formatAmount(outstanding) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4">
            <dt class="text-muted-foreground">Status</dt>
            <dd data-testid="status">
              <PaymentStatusBadge v-if="paymentStatus" :status="paymentStatus" />
              <span v-else>{{ PLACEHOLDER }}</span>
            </dd>
          </div>
        </dl>
      </section>

      <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>

      <!-- Save first when stacked; Cancel on the left when side by side. -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Button type="submit" class="h-12 text-base sm:order-last lg:order-none" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save Entry' }}
        </Button>
        <Button
          type="button"
          variant="secondary"
          class="h-12 text-base"
          :disabled="saving"
          @click="emit('cancel')"
        >
          Cancel
        </Button>
      </div>
    </div>
  </form>
</template>
