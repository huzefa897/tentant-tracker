<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, Gauge, ReceiptText } from '@lucide/vue'

import TenantSelector from '@/components/tenant/TenantSelector.vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TenantListStatus } from '@/stores/tenant'
import type { RecordKind } from '@/types/nav'
import type { Tenant } from '@/types/tenant'

// The + Record button's dialog: what to record (a bill or a meter reading), then for whom.
// Payments aren't here: a payment goes on a bill, so it's recorded from the bill.
const props = defineProps<{
  open: boolean
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
  choose: [kind: RecordKind, tenantId: string]
  search: [query: string]
  'load-more': []
}>()

const KINDS: { kind: RecordKind; label: string; hint: string; icon: typeof Gauge }[] = [
  {
    kind: 'bill',
    label: 'New bill',
    hint: 'Rent, water and electricity for a month',
    icon: ReceiptText,
  },
  {
    kind: 'reading',
    label: 'Meter reading',
    hint: 'What the meter says, or the units used',
    icon: Gauge,
  },
]

const kind = ref<RecordKind | null>(null)
// Set when the tenant chosen has no meter to record a reading on.
const noMeter = ref<Tenant | null>(null)

// Each open starts from the choice of what to record.
watch(
  () => props.open,
  (open) => {
    if (open) {
      kind.value = null
      noMeter.value = null
    }
  },
)

const chosen = computed(() => KINDS.find((option) => option.kind === kind.value) ?? null)

function chooseKind(next: RecordKind) {
  kind.value = next
  noMeter.value = null
}

function chooseTenant(tenantId: string) {
  if (!kind.value) return
  const tenant = props.tenants.find((t) => t.id === tenantId)
  if (kind.value === 'reading' && tenant && !tenant.meterBaseline) {
    noMeter.value = tenant
    return
  }
  noMeter.value = null
  emit('choose', kind.value, tenantId)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ chosen ? chosen.label : 'Record' }}</DialogTitle>
        <DialogDescription>
          {{ chosen ? 'Choose the tenant.' : 'What would you like to record?' }}
        </DialogDescription>
      </DialogHeader>

      <ul v-if="!chosen" class="space-y-2" data-testid="record-kinds">
        <li v-for="option in KINDS" :key="option.kind">
          <button
            type="button"
            class="flex w-full items-center gap-4 rounded-xl border p-4 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
            :data-testid="`record-${option.kind}`"
            @click="chooseKind(option.kind)"
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
            <ChevronRight class="text-muted-foreground" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <div v-else class="space-y-3">
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
          data-testid="record-no-meter"
        >
          {{ noMeter.name }}'s meter isn't set up, so there's no reading to record. An owner sets
          its starting reading in admin.
        </p>
        <Button variant="ghost" class="-ml-3 h-11" data-testid="record-change" @click="kind = null">
          Record something else
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
