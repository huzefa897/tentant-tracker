<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown, Search } from '@lucide/vue'
import type { AcceptableValue } from 'reka-ui'

import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
  ComboboxViewport,
} from '@/components/ui/combobox'
import type { Tenant } from '@/types/tenant'

const props = defineProps<{
  tenants: Tenant[]
  selectedTenantId: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [tenantId: string]
}>()

const search = ref('')

const selectedTenant = computed(
  () => props.tenants.find((tenant) => tenant.id === props.selectedTenantId) ?? null,
)

// Match on tenant name or flat number.
const filteredTenants = computed(() => {
  const query = search.value.trim().toLowerCase()

  if (!query) return props.tenants

  return props.tenants.filter(
    (tenant) =>
      tenant.name.toLowerCase().includes(query) || tenant.flatNumber.toLowerCase().includes(query),
  )
})

// Start each open from the full list rather than the last filter.
function handleSelect(value: AcceptableValue) {
  search.value = ''
  if (typeof value === 'string') emit('select', value)
}

// Reka also resets the input after a selection; without this it would show the tenant id.
const emptySearch = () => ''
</script>

<template>
  <Combobox
    :model-value="selectedTenantId ?? undefined"
    :disabled="disabled"
    ignore-filter
    @update:model-value="handleSelect"
  >
    <ComboboxAnchor as-child>
      <ComboboxTrigger as-child>
        <Button
          variant="outline"
          class="h-11 w-full justify-start gap-3 rounded-lg px-4 font-normal"
          aria-label="Select tenant"
        >
          <Search class="text-muted-foreground" aria-hidden="true" />
          <span v-if="selectedTenant" class="truncate">
            {{ selectedTenant.name }} - Flat {{ selectedTenant.flatNumber }}
          </span>
          <span v-else class="truncate text-muted-foreground">Search or select tenant...</span>
          <ChevronDown class="ml-auto text-muted-foreground" aria-hidden="true" />
        </Button>
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxList align="start">
      <ComboboxInput
        v-model="search"
        auto-focus
        :display-value="emptySearch"
        placeholder="Search by name or flat..."
        aria-label="Search tenants"
      />
      <ComboboxEmpty>No tenants found.</ComboboxEmpty>

      <ComboboxViewport>
        <ComboboxItem
          v-for="tenant in filteredTenants"
          :key="tenant.id"
          :value="tenant.id"
          class="py-2 pl-2"
        >
          <div class="min-w-0">
            <p class="truncate font-medium">{{ tenant.name }}</p>
            <p class="text-xs text-muted-foreground">Flat {{ tenant.flatNumber }}</p>
          </div>
          <ComboboxItemIndicator>
            <Check />
          </ComboboxItemIndicator>
        </ComboboxItem>
      </ComboboxViewport>
    </ComboboxList>
  </Combobox>
</template>
