<script setup lang="ts">
import { computed, ref } from 'vue'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { MeterReading } from '@/types/meterReading'
import { formatDateValue } from '@/utils/date'
import { formatReading } from '@/utils/electricity'
import { REASON_MAX_LENGTH, validateReason } from '@/utils/meterReadingValidation'

// Voids a reading recorded by mistake, with the reason. It stays in the list, marked void.
const props = defineProps<{
  reading: MeterReading
  saving?: boolean
  saveError?: string | null
}>()

const emit = defineEmits<{
  void: [reason: string]
  cancel: []
}>()

const reason = ref('')
const touched = ref(false)
const error = computed(() =>
  touched.value ? validateReason(reason.value, 'reading is being voided') : undefined,
)

function handleSubmit() {
  if (props.saving) return
  touched.value = true
  if (validateReason(reason.value, 'reading is being voided')) return
  emit('void', reason.value.trim())
}
</script>

<template>
  <form class="space-y-5" novalidate @submit.prevent="handleSubmit">
    <p class="rounded-xl border bg-muted/40 p-4 text-sm" data-testid="void-reading">
      <span class="font-semibold tabular-nums">{{ formatReading(reading.reading) }}</span>
      read on {{ formatDateValue(reading.readOn) }}
    </p>
    <p class="text-sm text-muted-foreground">
      It stays in the list, marked void, and no bill is measured from it.
    </p>

    <fieldset class="min-w-0 space-y-2" :disabled="saving">
      <div class="flex items-baseline justify-between gap-2">
        <Label for="void-reading-reason">Reason for voiding</Label>
        <span class="text-xs text-muted-foreground"
          >{{ reason.length }}/{{ REASON_MAX_LENGTH }}</span
        >
      </div>
      <Textarea
        id="void-reading-reason"
        v-model="reason"
        :maxlength="REASON_MAX_LENGTH"
        placeholder="e.g. Recorded on the wrong tenant"
        class="bg-background"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? 'void-reading-reason-error' : undefined"
        @blur="touched = true"
      />
      <p v-if="error" id="void-reading-reason-error" class="text-sm text-destructive" role="alert">
        {{ error }}
      </p>
    </fieldset>

    <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button type="submit" variant="destructive" class="h-11 sm:order-last" :disabled="saving">
        {{ saving ? 'Voiding…' : 'Void reading' }}
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
