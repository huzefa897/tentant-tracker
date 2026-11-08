<script setup lang="ts">
import { PhArrowClockwise, PhWarning } from '@phosphor-icons/vue'

import { Button } from '@/components/ui/button'

defineProps<{
  message: string
}>()

const emit = defineEmits<{
  retry: []
}>()
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center"
    role="alert"
  >
    <PhWarning class="size-5 shrink-0 text-destructive" aria-hidden="true" />
    <p class="flex-1 text-sm text-destructive">{{ message }}</p>
    <Button variant="outline" class="h-10 shrink-0" @click="emit('retry')">
      <PhArrowClockwise aria-hidden="true" />
      Retry
    </Button>
  </div>
</template>
