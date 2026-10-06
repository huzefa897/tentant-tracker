<script lang="ts">
// How long typing must pause before searching, so each keystroke isn't a request.
export const SEARCH_DEBOUNCE_MS = 300
</script>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, LoaderCircle, Search } from '@lucide/vue'
import type { AcceptableValue } from 'reka-ui'

import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
  ComboboxViewport,
} from '@/components/ui/combobox'
import type { TenantListStatus } from '@/stores/tenant'
import type { Tenant } from '@/types/tenant'

const props = defineProps<{
  // The current results, searched by the parent (the API matches name or flat number).
  tenants: Tenant[]
  // Passed in rather than found in `tenants`: a search can leave it out of the results.
  selectedTenant: Tenant | null
  // The query `tenants` answers, which decides the empty message.
  query: string
  status: TenantListStatus
  error?: string | null
  hasMore?: boolean
  loadingMore?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [tenantId: string]
  search: [query: string]
  'load-more': []
}>()

const search = ref('')
// The last query asked for, so the same search (or the reset) is never asked twice.
let requested = props.query
let timer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.query,
  (query) => (requested = query),
)

function requestSearch(query: string) {
  if (query === requested) return
  requested = query
  emit('search', query)
}

function cancelPendingSearch() {
  clearTimeout(timer)
  timer = undefined
}

watch(search, (value) => {
  cancelPendingSearch()
  timer = setTimeout(() => {
    timer = undefined
    requestSearch(value.trim())
  }, SEARCH_DEBOUNCE_MS)
})

onBeforeUnmount(cancelPendingSearch)

// Start each open from the full list rather than the last search.
function resetSearch() {
  search.value = ''
  cancelPendingSearch()
  requestSearch('')
}

function handleSelect(value: AcceptableValue) {
  resetSearch()
  if (typeof value === 'string') emit('select', value)
}

function handleOpen(open: boolean) {
  if (!open) resetSearch()
}

// Reka also resets the input after a selection; without this it would show the tenant id.
const emptySearch = () => ''
</script>

<template>
  <Combobox
    :model-value="selectedTenant?.id ?? undefined"
    :disabled="disabled"
    ignore-filter
    @update:model-value="handleSelect"
    @update:open="handleOpen"
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

      <div
        v-if="status === 'loading'"
        class="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground"
        role="status"
        data-testid="tenants-loading"
      >
        <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
        Loading tenants…
      </div>
      <p
        v-else-if="status === 'error'"
        class="px-3 py-3 text-center text-sm text-destructive"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-else-if="status === 'ready' && tenants.length === 0"
        class="py-3 text-center text-sm text-muted-foreground"
        data-testid="tenants-empty"
      >
        {{ query ? 'No matching tenants.' : 'No current tenants found.' }}
      </p>

      <ComboboxViewport v-if="status === 'ready' && tenants.length > 0">
        <ComboboxItem
          v-for="tenant in tenants"
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

      <!-- Load more failed: the results shown stay, and it can be tried again. -->
      <p
        v-if="status === 'ready' && error"
        class="border-t px-3 py-2 text-center text-sm text-destructive"
        role="alert"
      >
        {{ error }}
      </p>
      <div v-if="status === 'ready' && hasMore" class="border-t p-1">
        <Button
          variant="ghost"
          size="sm"
          class="w-full"
          :disabled="loadingMore"
          @click="emit('load-more')"
        >
          <LoaderCircle v-if="loadingMore" class="animate-spin" aria-hidden="true" />
          {{ loadingMore ? 'Loading…' : 'Load more' }}
        </Button>
      </div>
    </ComboboxList>
  </Combobox>
</template>
