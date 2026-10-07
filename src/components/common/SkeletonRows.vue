<script setup lang="ts">
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

// Rows the shape of the app's lists and tables (bills, payments, properties): a name, figures
// and an action. bordered: inside a rounded border, like the tables and pickers they stand in
// for.
withDefaults(defineProps<{ rows?: number; bordered?: boolean }>(), { rows: 4 })
</script>

<template>
  <div :class="cn('divide-y', bordered && 'rounded-xl border')">
    <div
      v-for="row in rows"
      :key="row"
      :class="cn('flex items-center gap-4 py-3.5', bordered && 'px-4')"
    >
      <Skeleton class="h-4 w-28 shrink-0" />
      <span class="flex-1" />
      <Skeleton class="hidden h-4 w-20 sm:block" />
      <Skeleton class="hidden h-4 w-20 md:block" />
      <Skeleton class="h-9 w-28 shrink-0" />
    </div>
  </div>
</template>
