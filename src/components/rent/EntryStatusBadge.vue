<script setup lang="ts">
import { Ban } from '@lucide/vue'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import type { RentEntry } from '@/types/rentEntry'

// A bill's status: VOID for a void bill (which is neither paid nor unpaid, and looks like
// neither), otherwise its payment status.
defineProps<{
  entry: Pick<RentEntry, 'billStatus' | 'status'>
}>()
</script>

<template>
  <span
    v-if="entry.billStatus === 'void' || !entry.status"
    class="inline-flex items-center gap-1.5 rounded-full border border-foreground/40 px-2.5 py-0.5 text-sm font-semibold tracking-wide text-foreground uppercase"
    data-testid="void-badge"
  >
    <Ban class="size-3.5" aria-hidden="true" />
    Void
  </span>
  <PaymentStatusBadge v-else :status="entry.status" />
</template>
