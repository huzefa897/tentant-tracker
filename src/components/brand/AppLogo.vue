<script setup lang="ts">
import { House } from '@lucide/vue'
</script>

<template>
  <div class="flex shrink-0 items-center gap-3">
    <span
      class="flex size-11 items-center justify-center rounded-xl bg-linear-to-br from-[#2a7bff] to-[#0b4fe0] text-white shadow-md shadow-primary/30"
    >
      <House class="size-6" :stroke-width="2.25" aria-hidden="true" />
    </span>
    <span class="text-lg font-semibold tracking-tight whitespace-nowrap">Tenant Manager</span>
  </div>
</template>
