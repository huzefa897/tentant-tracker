<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PhArrowLeft,
  PhCaretRight,
  PhGauge,
  PhHandCoins,
  PhReceipt,
  PhUser,
} from '@phosphor-icons/vue'

import TenantSelector from '@/components/tenant/TenantSelector.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { TenantListStatus } from '@/stores/tenant'
import type { QuickEntryStep, RecordKind } from '@/types/nav'
import type { Tenant } from '@/types/tenant'
import { isValidMonthValue } from '@/utils/date'

// Quick entry: what to record, then for whom, then (a bill only) which month. It only collects
// the answers: where the user is in it (`step`, `kind`) comes from the parent, which keeps each
// step in the browser's history so back goes to the step before. The parent also navigates to
// the existing forms once it's finished.
const props = defineProps<{
  open: boolean
  step: QuickEntryStep
  kind: RecordKind | null
  // The tenant whose page this was opened from, offered first.
  preselected?: Tenant | null
  // The tenant a bill is being made for (the month step).
  billTenant?: Tenant | null
  // The month a bill would be for: the one after the tenant's latest bill. null while it loads.
  defaultMonth?: string | null
  // The tenant search, as the parent runs it (the same props as TenantSelector).
  tenants: Tenant[]
  query: string
  status: TenantListStatus
  error?: string | null
  hasMore?: boolean
  loadingMore?: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  back: []
  'choose-kind': [kind: RecordKind]
  'choose-tenant': [kind: RecordKind, tenantId: string]
  'choose-month': [tenantId: string, month: string]
  search: [query: string]
  'load-more': []
}>()

const KINDS: { kind: RecordKind; label: string; hint: string; icon: typeof PhGauge }[] = [
  {
    kind: 'bill',
    label: 'New bill',
    hint: 'Rent, water and electricity for a month',
    icon: PhReceipt,
  },
  {
    kind: 'payment',
    label: 'Payment',
    hint: 'Money received on one of their bills',
    icon: PhHandCoins,
  },
  {
    kind: 'reading',
    label: 'Meter reading',
    hint: 'What the meter says, or the units used',
    icon: PhGauge,
  },
]

const chosen = computed(() => KINDS.find((option) => option.kind === props.kind) ?? null)

// Set when the tenant chosen has no meter to record a reading on.
const noMeter = ref<Tenant | null>(null)
watch(
  () => [props.open, props.step, props.kind],
  () => (noMeter.value = null),
)

function chooseTenant(tenantId: string) {
  if (!props.kind) return
  const tenant =
    props.preselected?.id === tenantId
      ? props.preselected
      : props.tenants.find((t) => t.id === tenantId)
  if (props.kind === 'reading' && tenant && !tenant.meterBaseline) {
    noMeter.value = tenant
    return
  }
  noMeter.value = null
  emit('choose-tenant', props.kind, tenantId)
}

// The month starts from the parent's default and stays whatever the user typed. A different
// tenant clears it, so the previous tenant's month is never offered (or submitted) while the
// new tenant's default loads.
const month = ref('')
const monthTouched = ref(false)
watch(
  () => [props.defaultMonth, props.billTenant?.id] as const,
  ([next, tenantId], previous) => {
    if (tenantId !== previous?.[1]) {
      monthTouched.value = false
      month.value = ''
    }
    if (!monthTouched.value && next) month.value = next
  },
  { immediate: true },
)
const monthValid = computed(() => isValidMonthValue(month.value))

function submitMonth() {
  if (!props.billTenant || !monthValid.value) return
  emit('choose-month', props.billTenant.id, month.value)
}

// The bill's later steps are the New bill form, shown one part at a time by the parent (slot).
const billStep = computed(
  () => props.step === 'charges' || props.step === 'payment' || props.step === 'confirm',
)

const TITLES: Partial<Record<QuickEntryStep, [string, string]>> = {
  charges: ['Rent and utilities', 'Rent, electricity and water for this bill.'],
  payment: ['Payment', 'Amount paid with this bill, and the running total.'],
  confirm: ['Confirm bill', 'Check the bill before it is saved.'],
}
const title = computed(() => {
  const fixed = TITLES[props.step]
  if (fixed) return fixed[0]
  if (props.step === 'kind' || !chosen.value) return 'Quick entry'
  return chosen.value.label
})
const description = computed(() => {
  const fixed = TITLES[props.step]
  if (fixed) return fixed[1]
  if (props.step === 'kind') return 'What would you like to record?'
  if (props.step === 'month') return 'Which month is the bill for?'
  return 'Choose the tenant.'
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <!-- A full-height sheet on a phone, a centred dialog from `sm` up. -->
    <DialogContent
      class="overflow-y-auto max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:content-start max-sm:rounded-none sm:max-h-[calc(100dvh-2rem)]"
      :class="billStep ? 'sm:max-w-2xl' : 'sm:max-w-md'"
      data-testid="quick-entry"
    >
      <DialogHeader>
        <div class="flex items-center gap-2">
          <Button
            v-if="step !== 'kind'"
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            data-testid="quick-back"
            @click="emit('back')"
          >
            <PhArrowLeft aria-hidden="true" />
          </Button>
          <DialogTitle>{{ title }}</DialogTitle>
        </div>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>

      <!-- Kept mounted while the bill is being made, so going back and forward loses nothing. -->
      <div v-show="billStep" data-testid="quick-bill-steps">
        <slot name="bill" />
      </div>

      <ul v-if="step === 'kind'" class="space-y-2" data-testid="quick-kinds">
        <li v-for="option in KINDS" :key="option.kind">
          <button
            type="button"
            class="flex w-full items-center gap-4 rounded-xl border p-4 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
            :data-testid="`quick-${option.kind}`"
            @click="emit('choose-kind', option.kind)"
          >
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"
              aria-hidden="true"
            >
              <component :is="option.icon" class="size-5" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block font-medium">{{ option.label }}</span>
              <span class="block text-sm text-muted-foreground">{{ option.hint }}</span>
            </span>
            <PhCaretRight class="text-muted-foreground" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <template v-else-if="billStep" />

      <form
        v-else-if="step === 'month' && billTenant"
        class="space-y-4"
        data-testid="quick-month-step"
        @submit.prevent="submitMonth"
      >
        <p
          class="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm text-secondary-foreground"
        >
          <PhUser class="size-4" aria-hidden="true" />
          {{ billTenant.name }} · Flat {{ billTenant.flatNumber }}
        </p>
        <div class="space-y-2">
          <Label for="quick-month">Billing month</Label>
          <Input
            id="quick-month"
            v-model="month"
            type="month"
            class="h-11"
            :disabled="!month && defaultMonth === null"
            @input="monthTouched = true"
          />
        </div>
        <Button type="submit" class="h-11 w-full" :disabled="!monthValid">
          Continue
          <PhCaretRight aria-hidden="true" />
        </Button>
      </form>

      <div v-else class="space-y-3">
        <button
          v-if="preselected"
          type="button"
          class="flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="quick-preselected"
          @click="chooseTenant(preselected.id)"
        >
          <PhUser class="size-5 text-primary" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block font-medium">{{ preselected.name }}</span>
            <span class="block text-sm text-muted-foreground">
              Flat {{ preselected.flatNumber }} · the tenant you are viewing
            </span>
          </span>
          <PhCaretRight class="text-muted-foreground" aria-hidden="true" />
        </button>
        <TenantSelector
          :tenants="tenants"
          :selected-tenant="null"
          :query="query"
          :status="status"
          :error="error"
          :has-more="hasMore"
          :loading-more="loadingMore"
          @select="chooseTenant"
          @search="emit('search', $event)"
          @load-more="emit('load-more')"
        />
        <p
          v-if="noMeter"
          class="text-sm text-destructive"
          role="alert"
          data-testid="quick-no-meter"
        >
          {{ noMeter.name }}'s meter isn't set up, so there's no reading to record. An owner sets
          its starting reading in admin.
        </p>
      </div>
    </DialogContent>
  </Dialog>
</template>
