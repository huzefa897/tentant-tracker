<script setup lang="ts">
import { computed } from 'vue'

import ToggleSwitch from '@/components/common/ToggleSwitch.vue'
import type { ReadingEntryMode } from '@/types/meterReading'

// How a new reading is entered: what the meter says (off), or the units used since the latest
// reading (on), which the backend adds to it. A switch row, like "Include electricity charges".
defineProps<{
  // The switch's id: unique on the page.
  id: string
}>()

const mode = defineModel<ReadingEntryMode>({ required: true })

const byUnits = computed({
  get: () => mode.value === 'units',
  set: (on: boolean) => (mode.value = on ? 'units' : 'reading'),
})
</script>

<template>
  <label
    :for="id"
    class="flex cursor-pointer items-center justify-between gap-4 rounded-lg border bg-background px-3 py-2.5"
    data-testid="reading-entry-toggle"
  >
    <span>
      <span class="block text-sm font-medium">Enter units used</span>
      <span class="block text-xs text-muted-foreground" data-testid="reading-entry-hint">
        {{
          byUnits
            ? 'Added to the latest meter reading.'
            : 'Off: enter the reading on the meter.'
        }}
      </span>
    </span>
    <ToggleSwitch :id="id" v-model="byUnits" />
  </label>
</template>
