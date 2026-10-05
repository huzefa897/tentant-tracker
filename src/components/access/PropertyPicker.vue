<script setup lang="ts">
import { Building2, Check, ChevronRight } from '@lucide/vue'

import type { PropertyAccess, PropertyRole } from '@/types/access'

defineProps<{
  properties: PropertyAccess[]
  selectedPropertyId: string | null
}>()

const emit = defineEmits<{
  select: [propertyId: string]
}>()

const ROLE_LABELS: Record<PropertyRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
}
</script>

<template>
  <ul class="flex flex-col gap-3" aria-label="Your properties">
    <li v-for="property in properties" :key="property.id">
      <button
        type="button"
        class="flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        :aria-current="property.id === selectedPropertyId ? 'true' : undefined"
        @click="emit('select', property.id)"
      >
        <span
          class="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"
          aria-hidden="true"
        >
          <Building2 class="size-5" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-semibold">{{ property.name }}</span>
          <span class="block text-sm text-muted-foreground">{{ ROLE_LABELS[property.role] }}</span>
        </span>
        <Check
          v-if="property.id === selectedPropertyId"
          class="size-5 shrink-0 text-primary"
          aria-label="Selected"
        />
        <ChevronRight v-else class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  </ul>
</template>
