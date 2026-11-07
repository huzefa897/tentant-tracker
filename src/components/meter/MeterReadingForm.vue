<script setup lang="ts">
import { computed, nextTick, reactive, ref, useTemplateRef } from 'vue'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { MeterPoint, MeterReading, MeterReadingInput } from '@/types/meterReading'
import { formatDateValue, toDateValue } from '@/utils/date'
import { formatReading } from '@/utils/electricity'
import {
  REASON_MAX_LENGTH,
  unitsBetween,
  validateMeterReadingDraft,
  validateReason,
  type MeterReadingDraft,
} from '@/utils/meterReadingValidation'
import { NOTES_MAX_LENGTH } from '@/utils/rentEntryValidation'

// Records a meter reading, or (with `correcting`) its replacement and why. It checks what it
// knows (not below `after`, not in the future); the backend checks it against every reading.
// Recording one never bills anything.
const props = defineProps<{
  // The reading it must follow, shown for reference: the latest active one, else the baseline.
  after: MeterPoint | null
  // The reading being corrected: the form starts from it and asks for a reason.
  correcting?: MeterReading | null
  saving?: boolean
  saveError?: string | null
}>()

const emit = defineEmits<{
  submit: [input: MeterReadingInput & { reason?: string }]
  cancel: []
}>()

const today = toDateValue(new Date())

const draft = reactive<MeterReadingDraft & { notes: string; reason: string }>({
  reading: props.correcting?.reading ?? '',
  readOn: props.correcting?.readOn ?? today,
  notes: props.correcting?.notes ?? '',
  reason: '',
})

type Field = 'reading' | 'readOn' | 'reason'
const submitted = ref(false)
const touched = reactive<Partial<Record<Field, boolean>>>({})

const errors = computed(() => {
  const found: Partial<Record<Field, string>> = validateMeterReadingDraft(draft, {
    after: props.after,
    today,
  })
  if (props.correcting) {
    const reason = validateReason(draft.reason, 'reading is being corrected')
    if (reason) found.reason = reason
  }
  return found
})

function errorFor(field: Field) {
  return submitted.value || touched[field] ? errors.value[field] : undefined
}

function fieldAttrs(field: Field) {
  const error = errorFor(field)
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `meter-${field}-error` : undefined,
    onBlur: () => (touched[field] = true),
  }
}

const units = computed(() => unitsBetween(props.after, draft.reading))

const formRef = useTemplateRef<HTMLFormElement>('form')

async function handleSubmit() {
  if (props.saving) return
  submitted.value = true
  if (Object.keys(errors.value).length > 0 || draft.reading === '') {
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  emit('submit', {
    reading: draft.reading,
    readOn: draft.readOn,
    notes: draft.notes.trim(),
    ...(props.correcting ? { reason: draft.reason.trim() } : {}),
  })
}
</script>

<template>
  <form ref="form" class="space-y-5" novalidate @submit.prevent="handleSubmit">
    <p v-if="after" class="text-sm text-muted-foreground" data-testid="meter-after">
      Previous reading {{ formatReading(after.reading) }} on {{ formatDateValue(after.readOn) }}
    </p>

    <fieldset class="min-w-0 space-y-4" :disabled="saving">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-2">
          <Label for="meter-reading">Meter reading</Label>
          <Input
            id="meter-reading"
            v-model.number="draft.reading"
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            required
            class="h-11 bg-background"
            v-bind="fieldAttrs('reading')"
          />
          <p
            v-if="errorFor('reading')"
            id="meter-reading-error"
            class="text-sm text-destructive"
            role="alert"
          >
            {{ errorFor('reading') }}
          </p>
          <p
            v-else-if="units !== null"
            class="text-sm text-muted-foreground"
            data-testid="meter-consumption"
          >
            {{ formatReading(units) }} units since the previous reading
          </p>
        </div>
        <div class="space-y-2">
          <Label for="meter-readOn">Read on</Label>
          <Input
            id="meter-readOn"
            v-model="draft.readOn"
            type="date"
            :max="today"
            required
            class="h-11 bg-background"
            v-bind="fieldAttrs('readOn')"
          />
          <p
            v-if="errorFor('readOn')"
            id="meter-readOn-error"
            class="text-sm text-destructive"
            role="alert"
          >
            {{ errorFor('readOn') }}
          </p>
        </div>
      </div>

      <div class="space-y-2">
        <Label for="meter-notes">Notes (optional)</Label>
        <Textarea
          id="meter-notes"
          v-model="draft.notes"
          :maxlength="NOTES_MAX_LENGTH"
          class="bg-background"
        />
      </div>

      <div v-if="correcting" class="space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <Label for="meter-reason">Reason for correcting</Label>
          <span class="text-xs text-muted-foreground">
            {{ draft.reason.length }}/{{ REASON_MAX_LENGTH }}
          </span>
        </div>
        <Textarea
          id="meter-reason"
          v-model="draft.reason"
          :maxlength="REASON_MAX_LENGTH"
          placeholder="e.g. Read 2,867 instead of 2,876"
          class="bg-background"
          v-bind="fieldAttrs('reason')"
        />
        <p
          v-if="errorFor('reason')"
          id="meter-reason-error"
          class="text-sm text-destructive"
          role="alert"
        >
          {{ errorFor('reason') }}
        </p>
      </div>
    </fieldset>

    <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button type="submit" class="h-11 sm:order-last" :disabled="saving">
        {{ saving ? 'Saving…' : correcting ? 'Correct reading' : 'Record reading' }}
      </Button>
      <Button
        type="button"
        variant="outline"
        class="h-11"
        :disabled="saving"
        @click="emit('cancel')"
      >
        Cancel
      </Button>
    </div>
  </form>
</template>
