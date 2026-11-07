<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue'
import { Droplet, Gauge, IndianRupee, Lock, Zap } from '@lucide/vue'

import ToggleSwitch from '@/components/common/ToggleSwitch.vue'
import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { MeterPoint } from '@/types/meterReading'
import type { NewRentEntrySubmission } from '@/types/rentEntry'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatDateValue, toDateValue, toMonthValue } from '@/utils/date'
import {
  type MeterReadingErrors,
  unitsBetween,
  validateMeterReadingDraft,
} from '@/utils/meterReadingValidation'
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
    // The month to start on (YYYY-MM), e.g. a missing bill's from the dashboard; this month
    // otherwise.
    month?: string | null
    // Shown above the actions, e.g. a duplicate-entry error from the store.
    saveError?: string | null
    // While the page saves: every field, Save and Cancel are disabled, so one click sends one
    // request, nothing typed afterwards is lost when the confirmation replaces the form, and the
    // bill can't be discarded while it's being created.
    saving?: boolean
    // For a tenant whose meter is set up: where this bill's electricity starts (the last billed
    // reading, from the backend), and whether it's still loading or failed to load. Without it
    // a meter bill can't be previewed or saved.
    lastBilled?: MeterPoint | null
    // The newest active reading, which a new reading must follow (the last billed one if the
    // meter has none).
    latestReading?: MeterPoint | null
    // A recorded reading no bill closes on yet: the bill closes on it unless a new reading is
    // chosen.
    unbilledReading?: MeterPoint | null
    meterLoading?: boolean
    meterError?: string | null
  }>(),
  {
    month: null,
    saveError: null,
    saving: false,
    lastBilled: null,
    latestReading: null,
    unbilledReading: null,
    meterLoading: false,
    meterError: null,
  },
)

const emit = defineEmits<{
  save: [submission: NewRentEntrySubmission]
  cancel: []
  dirtyChange: [dirty: boolean]
  retryMeter: []
}>()

const PLACEHOLDER = '—'

// Read once: the form is short-lived, and these are only defaults and the "future" limit.
const now = new Date()
const today = toDateValue(now)
const initialMonth = props.month ?? toMonthValue(now)

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
// Electricity: charged (typed units, or the meter's closing reading) or left off this bill.
const includeElectricity = ref(true)
const closingReading = ref<NumberInputValue>('')
// A recorded reading waiting to be billed is used unless a new reading is chosen.
const closingChoice = ref<'recorded' | 'new'>('recorded')
// The day the meter was read: the payment's date while it has one (and the reading can be dated
// then), else today, until changed.
const readOnTyped = ref<string | null>(null)

// The tenant's meter is set up (in admin): units come from readings, never typed.
const hasMeter = computed(() => props.tenant.meterBaseline !== null)
// A reading entered with electricity left off is recorded as a reading only.
const readingEntered = computed(() => closingReading.value !== '')
// The bill closes on the recorded reading: no reading is typed, and none is recorded with it.
const useRecorded = computed(
  () =>
    hasMeter.value &&
    includeElectricity.value &&
    props.unbilledReading !== null &&
    closingChoice.value === 'recorded',
)
// The reading a new one must follow.
const followedReading = computed(() => props.latestReading ?? props.lastBilled)
const meterUnits = computed(() =>
  unitsBetween(
    props.lastBilled,
    useRecorded.value ? props.unbilledReading!.reading : closingReading.value,
  ),
)

function canDateReadingOn(day: string): boolean {
  const after = followedReading.value
  if (!after) return true
  return after.id ? day > after.readOn : day >= after.readOn
}
const readOn = computed({
  get() {
    if (readOnTyped.value !== null) return readOnTyped.value
    const followed = paidDate.value || today
    return canDateReadingOn(followed) ? followed : today
  },
  set(value: string) {
    readOnTyped.value = value
  },
})

// What the bill charges in units: none when left off, the readings' difference on a meter, or
// the typed units. '' while it can't be worked out yet, so the total shows "—".
const effectiveUnits = computed<NumberInputValue>(() => {
  if (!includeElectricity.value) return 0
  if (hasMeter.value) return meterUnits.value ?? ''
  return electricityUnits.value
})

function setPaidDate(value: string) {
  paidDate.value = value
}

const draft = computed<RentEntryDraft>(() => ({
  billingMonth: billingMonth.value,
  rentAmount: rentAmount.value,
  electricityUnits: effectiveUnits.value,
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
    !includeElectricity.value ||
    (readingEntered.value && !useRecorded.value) ||
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
  const units = toAmount(effectiveUnits.value)
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
  const units = toAmount(effectiveUnits.value)
  const rent = toAmount(rentAmount.value)
  const water = toAmount(waterAmount.value)

  return [
    { label: 'Rent', value: formatAmount(rent !== null && rent > 0 ? rent : null) },
    includeElectricity.value
      ? {
          label:
            units !== null && units >= 0
              ? `Electricity: ${units} × ${formatINR(props.tenant.electricityRate)}`
              : 'Electricity',
          value: formatAmount(electricityAmount.value),
        }
      : { label: 'Electricity', value: 'Not charged' },
    { label: 'Water', value: formatAmount(water !== null && water >= 0 ? water : null) },
  ]
})

// Form fields by input id. The payment's own fields map to the payment rules.
type Field =
  keyof RentEntryDraft | 'paymentAmount' | 'paidDate' | 'paymentNotes' | 'closingReading' | 'readOn'

// The closing reading: needed to charge a meter, optional (a reading only) with electricity left
// off. A new one is checked against the newest reading; the backend checks the others too.
const meterErrors = computed<MeterReadingErrors & { meter?: string }>(() => {
  if (!hasMeter.value || (!includeElectricity.value && !readingEntered.value)) return {}
  if (!props.lastBilled) {
    return { meter: props.meterError ?? 'Loading the meter’s last billed reading…' }
  }
  if (useRecorded.value) return {}
  const found = validateMeterReadingDraft(
    { reading: closingReading.value, readOn: readOn.value },
    { after: followedReading.value, today },
  )
  if (includeElectricity.value && !readingEntered.value) {
    found.reading = 'Enter the closing meter reading, or leave electricity off this bill.'
  }
  return found
})

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
  // Units come from the readings (or there are none): their errors are the reading's.
  ...(hasMeter.value || !includeElectricity.value ? { electricityUnits: undefined } : {}),
  closingReading: meterErrors.value.reading,
  readOn: meterErrors.value.readOn,
  paymentAmount: paymentErrors.value.amount,
  paidDate: paymentErrors.value.paidDate,
  paymentNotes: paymentErrors.value.notes,
}))

const hasErrors = computed(
  () => Object.values(errors.value).some(Boolean) || Boolean(meterErrors.value.meter),
)

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

  const reading =
    hasMeter.value && readingEntered.value && !useRecorded.value
      ? { reading: closingReading.value as number, readOn: readOn.value }
      : null
  emit('save', {
    entry: {
      ...entry.input,
      useTenancyRent: rentAmount.value === props.tenant.rentAmount,
      includeElectricity: includeElectricity.value,
      closingReading: reading,
      ...(useRecorded.value ? { closingReadingId: props.unbilledReading!.id } : {}),
    },
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
          <p class="text-sm text-muted-foreground">Billing month and rent for this bill.</p>
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

        <label
          for="includeElectricity"
          class="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5"
        >
          <span>
            <span class="block text-sm font-medium">Include electricity charges</span>
            <span class="block text-xs text-muted-foreground" data-testid="electricity-choice-hint">
              {{
                includeElectricity
                  ? 'Charged on this bill.'
                  : hasMeter
                    ? 'Not charged: the units since the last billed reading go on a later bill.'
                    : 'Not charged on this bill.'
              }}
            </span>
          </span>
          <ToggleSwitch id="includeElectricity" v-model="includeElectricity" />
        </label>

        <div
          v-if="hasMeter && (meterLoading || meterError)"
          class="rounded-lg border bg-background p-3 text-sm"
          data-testid="meter-status"
        >
          <p v-if="meterError" class="text-destructive" role="alert">
            {{ meterError }}
            <Button type="button" variant="link" class="h-auto p-0" @click="emit('retryMeter')">
              Retry
            </Button>
          </p>
          <p v-else class="text-muted-foreground" aria-live="polite">Loading the meter…</p>
        </div>

        <div v-if="hasMeter" class="grid gap-4 sm:grid-cols-2" data-testid="meter-fields">
          <div v-if="includeElectricity" class="space-y-2">
            <p id="openingReading-label" class="text-sm font-medium">Opening reading</p>
            <div
              :class="lockedClass"
              aria-labelledby="openingReading-label"
              data-testid="opening-reading"
            >
              <span>
                {{ lastBilled ? lastBilled.reading.toLocaleString('en-IN') : PLACEHOLDER }}
                <span v-if="lastBilled" class="text-xs">
                  · {{ formatDateValue(lastBilled.readOn) }}
                </span>
              </span>
              <Lock class="size-4" aria-hidden="true" />
            </div>
            <p class="text-xs text-muted-foreground">The last reading billed for electricity.</p>
          </div>

          <div v-if="useRecorded" class="space-y-2">
            <p id="recordedReading-label" class="text-sm font-medium">Closing reading</p>
            <div
              :class="lockedClass"
              aria-labelledby="recordedReading-label"
              data-testid="recorded-reading"
            >
              <span>
                {{ unbilledReading!.reading.toLocaleString('en-IN') }}
                <span class="text-xs"> · {{ formatDateValue(unbilledReading!.readOn) }}</span>
              </span>
              <Lock class="size-4" aria-hidden="true" />
            </div>
            <p class="text-xs text-muted-foreground">
              Already recorded.
              <Button
                type="button"
                variant="link"
                class="h-auto p-0 text-xs"
                @click="closingChoice = 'new'"
              >
                Record a new reading instead
              </Button>
            </p>
          </div>

          <div v-else class="space-y-2">
            <Label for="closingReading">
              <template v-if="includeElectricity">Closing reading</template>
              <template v-else>
                Meter reading <span class="text-muted-foreground">(optional, not charged)</span>
              </template>
            </Label>
            <div class="relative">
              <Gauge
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="closingReading"
                v-model.number="closingReading"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                :required="includeElectricity"
                placeholder="e.g. 2985"
                :class="[inputClass, 'pl-9']"
                v-bind="fieldAttrs('closingReading')"
              />
            </div>
            <p
              v-if="errorFor('closingReading')"
              id="closingReading-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('closingReading') }}
            </p>
            <p v-if="includeElectricity && unbilledReading" class="text-xs">
              <Button
                type="button"
                variant="link"
                class="h-auto p-0 text-xs"
                @click="closingChoice = 'recorded'"
              >
                Use the recorded reading ({{ unbilledReading.reading.toLocaleString('en-IN') }},
                {{ formatDateValue(unbilledReading.readOn) }})
              </Button>
            </p>
          </div>

          <div v-if="!useRecorded && (includeElectricity || readingEntered)" class="space-y-2">
            <Label for="readOn">Reading date</Label>
            <Input
              id="readOn"
              v-model="readOn"
              type="date"
              :max="today"
              :class="inputClass"
              v-bind="fieldAttrs('readOn')"
            />
            <p
              v-if="errorFor('readOn')"
              id="readOn-error"
              class="text-sm text-destructive"
              role="alert"
            >
              {{ errorFor('readOn') }}
            </p>
          </div>

          <div v-if="includeElectricity" class="space-y-2">
            <p id="meterUnits-label" class="text-sm font-medium">Units used</p>
            <div :class="lockedClass" aria-labelledby="meterUnits-label" data-testid="meter-units">
              {{ meterUnits === null ? PLACEHOLDER : meterUnits.toLocaleString('en-IN') }}
              <Lock class="size-4" aria-hidden="true" />
            </div>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div v-if="!hasMeter && includeElectricity" class="space-y-2">
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

          <div v-if="includeElectricity" class="space-y-2">
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

          <div v-if="includeElectricity" class="space-y-2">
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
            Later payments can be added from the bill's page.
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
              @update:model-value="setPaidDate(String($event))"
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
          {{ saving ? 'Saving…' : 'Save bill' }}
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
