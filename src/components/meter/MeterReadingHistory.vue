<script setup lang="ts">
import { Ban, PencilLine } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { MeterReading } from '@/types/meterReading'
import { formatDateValue, formatMonthValue } from '@/utils/date'
import { formatReading } from '@/utils/electricity'

// A tenancy's readings, newest first: each with its consumption, the units it was entered as
// (when it wasn't read off the meter) and the bill it closes, if any. Void ones stay, muted,
// with why. A billed reading can't be changed until its bills are
// voided: the backend refuses, and the page lists those bills.
defineProps<{
  readings: MeterReading[]
  // Recording and correcting readings (owners and managers).
  canEdit: boolean
}>()

const emit = defineEmits<{
  correct: [reading: MeterReading]
  void: [reading: MeterReading]
}>()
</script>

<template>
  <p
    v-if="readings.length === 0"
    class="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"
  >
    No readings yet. Record one here, or with the next bill.
  </p>
  <ul v-else class="divide-y rounded-xl border" data-testid="meter-readings">
    <li
      v-for="reading in readings"
      :key="reading.id"
      class="flex flex-wrap items-start justify-between gap-3 p-4"
      :class="reading.status === 'void' && 'text-muted-foreground'"
      data-testid="meter-reading"
    >
      <div class="min-w-0">
        <p class="font-semibold tabular-nums" :class="reading.status === 'void' && 'line-through'">
          {{ formatReading(reading.reading) }}
        </p>
        <p class="text-sm text-muted-foreground">
          {{ formatDateValue(reading.readOn) }}
          <template v-if="reading.consumption !== null">
            · {{ formatReading(reading.consumption) }} units since the previous
          </template>
        </p>
        <p
          v-if="reading.enteredUnits !== null"
          class="mt-1 text-sm text-muted-foreground"
          data-testid="reading-entered-units"
        >
          Entered as {{ formatReading(reading.enteredUnits) }} units, not read off the meter
        </p>
        <p v-if="reading.status === 'void'" class="mt-1 text-sm" data-testid="reading-void">
          VOID · {{ reading.voided?.reason }}
        </p>
        <p v-else-if="reading.billedBy" class="mt-1 text-sm" data-testid="reading-billed">
          Billed on the {{ formatMonthValue(reading.billedBy.billingMonth) }} bill
        </p>
        <p v-else class="mt-1 text-sm text-muted-foreground" data-testid="reading-unbilled">
          Not billed yet
        </p>
        <p v-if="reading.notes" class="mt-1 text-sm break-words">{{ reading.notes }}</p>
      </div>
      <div v-if="canEdit && reading.status === 'active'" class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-9"
          :aria-label="`Correct reading ${formatReading(reading.reading)}`"
          @click="emit('correct', reading)"
        >
          <PencilLine aria-hidden="true" />
          Correct
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-9"
          :aria-label="`Void reading ${formatReading(reading.reading)}`"
          @click="emit('void', reading)"
        >
          <Ban aria-hidden="true" />
          Void
        </Button>
      </div>
    </li>
  </ul>
</template>
