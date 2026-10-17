<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RotateCw } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { formatClockTime, formatTimeAgo } from '@/utils/date'

// When what's shown was loaded, and Refresh. A failed refresh says so and keeps the time of
// the figures still shown; Refresh is then the way to try again.
const props = defineProps<{
  // Date.now() of the last successful load; null before the first.
  loadedAt: number | null
  refreshing: boolean
  error: string | null
}>()

const emit = defineEmits<{
  refresh: []
}>()

// "Updated 2 minutes ago" moves on by itself.
const now = ref(Date.now())
const timer = window.setInterval(() => {
  now.value = Date.now()
}, 30_000)
onBeforeUnmount(() => window.clearInterval(timer))

const updated = computed(() =>
  props.loadedAt === null ? null : `Updated ${formatTimeAgo(props.loadedAt, now.value)}`,
)
const shownFrom = computed(() => (props.loadedAt === null ? '' : formatClockTime(props.loadedAt)))
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
    <p
      v-if="error && loadedAt !== null"
      class="text-sm text-destructive"
      role="alert"
      data-testid="refresh-error"
    >
      Couldn’t refresh. Showing data from {{ shownFrom }}.
    </p>
    <p
      v-else-if="updated"
      class="text-sm text-muted-foreground"
      aria-live="polite"
      data-testid="updated-at"
    >
      {{ refreshing ? 'Refreshing…' : updated }}
    </p>
    <Button
      variant="ghost"
      class="h-10"
      :disabled="refreshing"
      data-testid="refresh"
      @click="emit('refresh')"
    >
      <RotateCw :class="{ 'motion-safe:animate-spin': refreshing }" aria-hidden="true" />
      Refresh
    </Button>
  </div>
</template>
