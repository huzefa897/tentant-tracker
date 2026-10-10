<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { TriangleAlert } from '@lucide/vue'

import EntryPaymentsToReverse from '@/components/rent/EntryPaymentsToReverse.vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Payment } from '@/types/payment'
import type { RentEntry } from '@/types/rentEntry'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatMonthValue } from '@/utils/date'
import { VOID_REASON_MAX_LENGTH, validateVoidReason } from '@/utils/rentEntryValidation'

// Confirms voiding a bill that should not exist: which bill, what voiding does, and why. A bill
// with payments that still count can't be voided: they're listed, to reverse first. The page
// voids it (the backend checks the owner's role and records who did it).
const props = defineProps<{
  tenant: Pick<Tenant, 'name' | 'flatNumber'>
  entry: Pick<RentEntry, 'billingMonth' | 'totalDue'>
  // The bill's payments that still count (not reversed).
  paymentsToReverse: Payment[]
  saving?: boolean
  saveError?: string | null
}>()

const emit = defineEmits<{
  void: [reason: string]
  cancel: []
}>()

const reason = ref('')
const touched = ref(false)
const error = computed(() => (touched.value ? validateVoidReason(reason.value) : null))
const blocked = computed(() => props.paymentsToReverse.length > 0)

const formRef = useTemplateRef<HTMLFormElement>('form')

async function handleSubmit() {
  if (props.saving || blocked.value) return
  touched.value = true
  if (validateVoidReason(reason.value)) {
    await nextTick()
    formRef.value?.querySelector<HTMLElement>('#void-reason')?.focus()
    return
  }
  emit('void', reason.value.trim())
}
</script>

<template>
  <form ref="form" class="space-y-5" novalidate @submit.prevent="handleSubmit">
    <dl class="space-y-1.5 rounded-xl border bg-muted/40 p-4 text-sm" data-testid="void-entry">
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Tenant</dt>
        <dd class="text-right font-medium">{{ tenant.name }} · Flat {{ tenant.flatNumber }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Billing month</dt>
        <dd class="font-medium">{{ formatMonthValue(entry.billingMonth) }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Total due</dt>
        <dd class="font-semibold tabular-nums">{{ formatINR(entry.totalDue) }}</dd>
      </div>
    </dl>

    <EntryPaymentsToReverse v-if="blocked" :payments="paymentsToReverse" action="voided" />

    <template v-else>
      <div
        class="flex gap-3 rounded-lg bg-warning/10 p-3 text-sm text-foreground"
        data-testid="void-effects"
      >
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <ul class="space-y-1">
          <li>It stays in the history, marked <strong>VOID</strong>, with its charges.</li>
          <li>It no longer counts towards any total or balance.</li>
          <li>The month can have a new bill. To fix wrong charges, use Correct bill instead.</li>
        </ul>
      </div>

      <fieldset class="min-w-0 space-y-2" :disabled="saving" data-testid="fields">
        <div class="flex items-baseline justify-between gap-2">
          <Label for="void-reason">Reason for voiding</Label>
          <span class="text-xs text-muted-foreground">
            {{ reason.length }}/{{ VOID_REASON_MAX_LENGTH }}
          </span>
        </div>
        <Textarea
          id="void-reason"
          v-model="reason"
          :maxlength="VOID_REASON_MAX_LENGTH"
          placeholder="e.g. Entered twice for October"
          class="bg-background"
          :aria-invalid="error ? true : undefined"
          :aria-describedby="error ? 'void-reason-error' : undefined"
          @blur="touched = true"
        />
        <p v-if="error" id="void-reason-error" class="text-sm text-destructive" role="alert">
          {{ error }}
        </p>
      </fieldset>
    </template>

    <p v-if="saveError" class="text-sm text-destructive" role="alert">{{ saveError }}</p>

    <div class="grid gap-3 sm:grid-cols-2">
      <Button
        v-if="!blocked"
        type="submit"
        variant="destructive"
        class="h-11 sm:order-last"
        :disabled="saving"
      >
        {{ saving ? 'Voiding…' : 'Void bill' }}
      </Button>
      <Button
        type="button"
        variant="secondary"
        class="h-11"
        :class="{ 'sm:col-span-2': blocked }"
        :disabled="saving"
        @click="emit('cancel')"
      >
        {{ blocked ? 'Close' : 'Cancel' }}
      </Button>
    </div>
  </form>
</template>
