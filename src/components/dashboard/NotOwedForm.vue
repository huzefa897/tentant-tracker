<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { RentalPeriodRow } from '@/types/dashboard'
import { formatDateValue, formatMonthValue } from '@/utils/date'
import { NOT_OWED_REASON_MAX_LENGTH, validateNotOwedReason } from '@/utils/rentalPeriods'

// Confirms that a month's rent isn't owed (waived, or settled before the app), and why. The
// month then stops counting as due and can't have a bill; the backend records who and when.
const props = defineProps<{
  period: Pick<RentalPeriodRow, 'name' | 'flatNumber' | 'periodMonth' | 'dueDate'>
  saving?: boolean
  saveError?: string | null
}>()

const emit = defineEmits<{
  save: [reason: string]
  cancel: []
}>()

const reason = ref('')
const touched = ref(false)
const error = computed(() => (touched.value ? validateNotOwedReason(reason.value) : null))

const formRef = useTemplateRef<HTMLFormElement>('form')

async function handleSubmit() {
  if (props.saving) return
  touched.value = true
  if (validateNotOwedReason(reason.value)) {
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('#not-owed-reason')?.focus()
    return
  }
  emit('save', reason.value.trim())
}
</script>

<template>
  <form ref="form" class="space-y-5" novalidate @submit.prevent="handleSubmit">
    <dl class="space-y-1.5 rounded-xl border bg-muted/40 p-4 text-sm" data-testid="not-owed-period">
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Tenant</dt>
        <dd class="text-right font-medium">{{ period.name }} · Flat {{ period.flatNumber }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Month</dt>
        <dd class="font-medium">{{ formatMonthValue(period.periodMonth) }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Was due</dt>
        <dd class="font-medium">{{ formatDateValue(period.dueDate) }}</dd>
      </div>
    </dl>

    <p class="text-sm text-muted-foreground">
      The month stops counting as due or overdue, and can’t have a bill. Use it only for rent that
      isn’t owed: waived, or settled before the app.
    </p>

    <fieldset class="min-w-0 space-y-2" :disabled="saving">
      <div class="flex items-baseline justify-between gap-2">
        <Label for="not-owed-reason">Why it isn’t owed</Label>
        <span class="text-xs text-muted-foreground">
          {{ reason.length }}/{{ NOT_OWED_REASON_MAX_LENGTH }}
        </span>
      </div>
      <Textarea
        id="not-owed-reason"
        v-model="reason"
        :maxlength="NOT_OWED_REASON_MAX_LENGTH"
        placeholder="e.g. Paid in cash in August, recorded in the old sheet"
        class="bg-background"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? 'not-owed-reason-error' : undefined"
        @blur="touched = true"
      />
      <p v-if="error" id="not-owed-reason-error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>
    </fieldset>

    <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button type="submit" class="h-11 sm:order-last" :disabled="saving">
        {{ saving ? 'Saving…' : 'Mark not owed' }}
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
