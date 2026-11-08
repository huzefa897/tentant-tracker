<script setup lang="ts">
import { computed } from 'vue'

import ToggleSwitch from '@/components/common/ToggleSwitch.vue'
import type { ReadingEntryMode } from '@/types/meterReading'

// How a new reading is entered: on (the default) records what the meter says; off records the
// units used since the latest reading, which the backend adds to it. A switch row, like
// "Include electricity charges".
defineProps<{
  // The switch's id: unique on the page.
  id: string
}>()

const mode = defineModel<ReadingEntryMode>({ required: true })

const byReading = computed({
  get: () => mode.value === 'reading',
  set: (on: boolean) => (mode.value = on ? 'reading' : 'units'),
})
</script>

<template>
  <label
    :for="id"
    class="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5"
    data-testid="reading-entry-toggle"
  >
    <span>
      <span class="block text-sm font-medium">Record meter reading</span>
      <span class="block text-xs text-muted-foreground" data-testid="reading-entry-hint">
        {{ byReading ? 'Enter the reading on the meter.' : 'Off: enter the units used instead.' }}
      </span>
    </span>
    <ToggleSwitch :id="id" v-model="byReading" />
  </label>
</template>
