<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Building2, CalendarDays, ChevronDown, Search, X } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMonthValue } from '@/utils/date'

// Narrows the overdue list: a tenant name or flat (sent once typing pauses, or on Enter), one
// property (offered only with more than one) and one billing month. Each select shows its name
// and value over a native select, which stays the control (keyboard, screen readers, the
// phone's picker).
const props = defineProps<{
  properties: { id: string; name: string }[]
  // Billing months to offer (YYYY-MM), newest first.
  months: string[]
}>()

const propertyId = defineModel<string | null>('propertyId', { required: true })
const month = defineModel<string | null>('month', { required: true })
const search = defineModel<string>('search', { required: true })

const emit = defineEmits<{
  // Back to the full list, in one change.
  clear: []
}>()

const SEARCH_DELAY_MS = 300
const SEARCH_MAX_LENGTH = 100

// What's typed, sent to the model once typing pauses.
const typed = ref(search.value)
let timer: number | undefined

watch(search, (next) => {
  if (next !== typed.value) typed.value = next
})

function onType(value: string | number) {
  typed.value = String(value)
  window.clearTimeout(timer)
  timer = window.setTimeout(sendSearch, SEARCH_DELAY_MS)
}

function sendSearch() {
  window.clearTimeout(timer)
  if (typed.value !== search.value) search.value = typed.value
}

onBeforeUnmount(() => window.clearTimeout(timer))

const ALL = 'all'

const selects = computed(() => [
  ...(props.properties.length > 1
    ? [
        {
          id: 'overdue-filter-property',
          label: 'Property',
          icon: Building2,
          selected: propertyId.value ?? ALL,
          shown: props.properties.find((p) => p.id === propertyId.value)?.name ?? 'All',
          options: [
            { value: ALL, label: 'All properties' },
            ...props.properties.map((p) => ({ value: p.id, label: p.name })),
          ],
        },
      ]
    : []),
  {
    id: 'overdue-filter-month',
    label: 'Month',
    icon: CalendarDays,
    selected: month.value ?? ALL,
    shown: month.value ? formatMonthValue(month.value) : 'All',
    options: [
      { value: ALL, label: 'All months' },
      ...props.months.map((value) => ({ value, label: formatMonthValue(value) })),
    ],
  },
])

const narrowed = computed(
  () => propertyId.value !== null || month.value !== null || typed.value.trim() !== '',
)

function choose(id: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const next = value === ALL ? null : value
  if (id === 'overdue-filter-property') propertyId.value = next
  else month.value = next
}

function clear() {
  window.clearTimeout(timer)
  typed.value = ''
  emit('clear')
}
</script>

<template>
  <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
    <form role="search" class="relative min-w-0 lg:max-w-sm lg:flex-1" @submit.prevent="sendSearch">
      <Search
        class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        :model-value="typed"
        type="search"
        aria-label="Search by tenant name or flat"
        placeholder="Search tenant or flat"
        :maxlength="SEARCH_MAX_LENGTH"
        class="h-11 bg-background pl-9"
        data-testid="overdue-search"
        @update:model-value="onType"
      />
    </form>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div
        v-for="select in selects"
        :key="select.id"
        class="relative flex h-11 min-w-0 items-center gap-3 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:bg-muted/50 has-[select:focus-visible]:border-ring has-[select:focus-visible]:ring-3 has-[select:focus-visible]:ring-ring/50 sm:max-w-xs sm:flex-1 lg:w-52 lg:flex-none"
      >
        <component
          :is="select.icon"
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate" aria-hidden="true" data-testid="filter-summary">
          <span class="text-muted-foreground">{{ `${select.label}: ` }}</span>
          <span class="font-semibold">{{ select.shown }}</span>
        </span>
        <ChevronDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <select
          :id="select.id"
          :value="select.selected"
          :aria-label="select.label"
          class="absolute inset-0 size-full cursor-pointer opacity-0"
          :data-testid="select.id"
          @change="choose(select.id, $event)"
        >
          <option v-for="option in select.options" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <Button
        v-if="narrowed"
        variant="ghost"
        class="h-11 w-fit"
        data-testid="overdue-clear-filters"
        @click="clear"
      >
        <X aria-hidden="true" />
        Clear filters
      </Button>
    </div>
  </div>
</template>
