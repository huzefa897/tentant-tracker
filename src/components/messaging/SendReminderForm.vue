<script setup lang="ts">
import { PhChatText } from '@phosphor-icons/vue'

import { Button } from '@/components/ui/button'
import type { RentEntry } from '@/types/rentEntry'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'

// Confirms texting a tenant a reminder about one bill, so a tap never texts anyone by itself.
// The page sends it; the backend writes the text and sends at most one a day per bill.
defineProps<{
  tenant: Pick<Tenant, 'name' | 'flatNumber'>
  entry: Pick<RentEntry, 'billingMonth' | 'outstanding'>
  sending?: boolean
  sendError?: string | null
}>()

const emit = defineEmits<{
  send: []
  cancel: []
}>()
</script>

<template>
  <form class="space-y-5" novalidate @submit.prevent="emit('send')">
    <dl class="space-y-1.5 rounded-xl border bg-muted/40 p-4 text-sm" data-testid="reminder-bill">
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Tenant</dt>
        <dd class="text-right font-medium">{{ tenant.name }} · Flat {{ tenant.flatNumber }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Billing month</dt>
        <dd class="font-medium">{{ formatMonthValue(entry.billingMonth) }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Outstanding</dt>
        <dd class="font-semibold tabular-nums">{{ formatINR(entry.outstanding) }}</dd>
      </div>
    </dl>

    <p class="text-sm text-muted-foreground">
      They'll get an SMS on their mobile number saying what's outstanding for this month and whether
      it's due or overdue. One a day per bill.
    </p>

    <p v-if="sendError" class="text-sm text-destructive" role="alert">{{ sendError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button type="submit" class="h-11 sm:order-last" :disabled="sending">
        <PhChatText aria-hidden="true" />
        {{ sending ? 'Sending…' : 'Send SMS' }}
      </Button>
      <Button
        type="button"
        variant="secondary"
        class="h-11"
        :disabled="sending"
        @click="emit('cancel')"
      >
        Cancel
      </Button>
    </div>
  </form>
</template>
