<script setup lang="ts">
import { Ban } from '@lucide/vue'

import DueStatusBadge from '@/components/rent/DueStatusBadge.vue'
import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'
import type { RentEntry } from '@/types/rentEntry'

// A bill's status: VOID for a void bill (which is neither paid nor unpaid, and looks like
// neither), otherwise its payment status, with Overdue or Due today beside it when the money is
// late (a partially paid bill can be both).
defineProps<{
  entry: Pick<RentEntry, 'billStatus' | 'status' | 'dueStatus'>
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
  <span v-else class="inline-flex flex-wrap items-center gap-1.5">
    <PaymentStatusBadge :status="entry.status" />
    <DueStatusBadge :status="entry.dueStatus" />
  </span>
</template>
