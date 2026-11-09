<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { PhCaretRight, PhGauge, PhMagnifyingGlass, PhSpinnerGap } from '@phosphor-icons/vue'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import { SEARCH_DEBOUNCE_MS } from '@/components/tenant/TenantSelector.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TenantListStatus } from '@/stores/tenant'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatOrdinal } from '@/utils/date'

// The property's current tenants, searched by name or flat (the parent runs the search), each
// opening that tenant's page.
const props = defineProps<{
  tenants: Tenant[]
  // The query `tenants` answers, which decides the empty message.
  query: string
  status: TenantListStatus
  error?: string | null
  hasMore?: boolean
  loadingMore?: boolean
}>()

const emit = defineEmits<{
  open: [tenantId: string]
  search: [query: string]
  'load-more': []
  retry: []
}>()

const search = ref(props.query)
let timer: ReturnType<typeof setTimeout> | undefined

// Searches once typing pauses, so each keystroke isn't a request.
watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    if (value.trim() !== props.query) emit('search', value.trim())
  }, SEARCH_DEBOUNCE_MS)
})

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div>
    <div class="relative mb-4 max-w-xl">
      <PhMagnifyingGlass
        class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        v-model="search"
        type="search"
        class="h-11 bg-background pl-9"
        placeholder="Search by name or flat..."
        aria-label="Search tenants"
      />
    </div>

    <!-- The first load, and each new search: the rows' shape, never an empty list. -->
    <LoadingRegion
      v-if="status === 'loading'"
      label="Loading tenants…"
      data-testid="tenants-loading"
    >
      <SkeletonRows bordered :rows="5" />
    </LoadingRegion>

    <RentEntriesLoadError
      v-else-if="status === 'error'"
      :message="error ?? ''"
      data-testid="tenants-error"
      @retry="emit('retry')"
    />

    <p
      v-else-if="status === 'ready' && tenants.length === 0"
      class="rounded-xl border border-dashed px-4 py-8 text-center text-muted-foreground"
      data-testid="tenants-empty"
    >
      {{ query ? 'No matching tenants.' : 'No current tenants.' }}
    </p>

    <template v-else-if="status === 'ready'">
      <ul class="divide-y rounded-xl border" data-testid="tenant-list">
        <li v-for="tenant in tenants" :key="tenant.id">
          <button
            type="button"
            class="flex w-full items-center gap-4 px-4 py-3.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            :data-testid="`tenant-${tenant.id}`"
            @click="emit('open', tenant.id)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ tenant.name }}</span>
              <span class="block text-sm text-muted-foreground">Flat {{ tenant.flatNumber }}</span>
            </span>
            <span class="shrink-0 text-right text-sm">
              <span class="block font-semibold tabular-nums">{{
                formatINR(tenant.rentAmount)
              }}</span>
              <span class="block text-muted-foreground">
                Due {{ formatOrdinal(tenant.rentDueDay) }}
              </span>
            </span>
            <PhGauge
              v-if="tenant.meterBaseline"
              class="size-4 shrink-0 text-muted-foreground max-sm:hidden"
              aria-label="Meter tracked"
            />
            <PhCaretRight class="shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <!-- Load more failed: the tenants shown stay, and it can be tried again. -->
      <p v-if="error" class="mt-3 text-sm text-destructive" role="alert">{{ error }}</p>
      <Button
        v-if="hasMore"
        variant="outline"
        class="mt-4 h-11 w-full sm:w-auto"
        :disabled="loadingMore"
        @click="emit('load-more')"
      >
        <PhSpinnerGap v-if="loadingMore" class="animate-spin" aria-hidden="true" />
        {{ loadingMore ? 'Loading…' : 'Load more' }}
      </Button>
    </template>
  </div>
</template>
