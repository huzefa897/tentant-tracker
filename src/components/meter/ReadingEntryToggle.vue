<script setup lang="ts">
import type { ReadingEntryMode } from '@/types/meterReading'

// How a new reading is entered: what the meter says, or the units used since the latest
// reading (the backend adds them to it). Native radios, so the arrow keys and screen readers
// treat it as one choice.
defineProps<{
  // The radios' group name: unique on the page.
  name: string
  disabled?: boolean
}>()

const mode = defineModel<ReadingEntryMode>({ required: true })

const options: { value: ReadingEntryMode; label: string }[] = [
  { value: 'reading', label: 'Meter reading' },
  { value: 'units', label: 'Units used' },
]
</script>

<template>
  <fieldset class="min-w-0" :disabled="disabled" data-testid="reading-entry-toggle">
    <legend class="sr-only">Enter the meter reading or the units used</legend>
    <div class="inline-grid grid-cols-2 rounded-lg border bg-muted p-0.5 text-sm">
      <label
        v-for="option in options"
        :key="option.value"
        class="cursor-pointer rounded-md px-3 py-1.5 text-center font-medium text-muted-foreground transition-colors has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-60"
      >
        <input
          v-model="mode"
          type="radio"
          class="sr-only"
          :name="name"
          :value="option.value"
          :data-testid="`entry-${option.value}`"
        />
        {{ option.label }}
      </label>
    </div>
  </fieldset>
</template>
