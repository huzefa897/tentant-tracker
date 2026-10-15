<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { formatMonthValue, nextMonthValue, previousMonthValue } from '@/utils/date'

// One month at a time, back or forward (YYYY-MM).
const month = defineModel<string>({ required: true })

defineProps<{
  disabled?: boolean
}>()

const label = computed(() => formatMonthValue(month.value))
</script>

<template>
  <div class="inline-flex items-center gap-1" role="group" aria-label="Billing month">
    <Button
      variant="ghost"
      size="icon"
      class="size-10"
      aria-label="Previous month"
      :disabled="disabled"
      @click="month = previousMonthValue(month)"
    >
      <ChevronLeft aria-hidden="true" />
    </Button>
    <span class="min-w-32 text-center text-sm font-medium" aria-live="polite">{{ label }}</span>
    <Button
      variant="ghost"
      size="icon"
      class="size-10"
      aria-label="Next month"
      :disabled="disabled"
      @click="month = nextMonthValue(month)"
    >
      <ChevronRight aria-hidden="true" />
    </Button>
  </div>
</template>
