<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  Building2,
  CalendarDays,
  History,
  Phone,
  Plus,
  ShieldCheck,
  User,
  Wallet,
  Zap,
} from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatOrdinal } from '@/utils/date'
import { formatIndianPhoneNumberNational } from '@/utils/phone'

const props = defineProps<{
  tenant: Tenant
  // Saved entries for this tenant; null while unknown (not loaded, or loading failed).
  entryCount?: number | null
}>()

const emit = defineEmits<{
  addEntry: []
  viewEntries: []
}>()

interface DetailItem {
  label: string
  value: string
  icon: Component
  // lg layout: first row has 3 tiles, second row 4
  span: string
}

const details = computed<DetailItem[]>(() => [
  { label: 'Name of Tenant', value: props.tenant.name, icon: User, span: 'lg:col-span-4' },
  {
    label: 'Rent Amount',
    value: formatINR(props.tenant.rentAmount),
    icon: Wallet,
    span: 'lg:col-span-4',
  },
  {
    label: 'Flat Number',
    value: props.tenant.flatNumber,
    icon: Building2,
    span: 'lg:col-span-4',
  },
  {
    label: 'Rent Due Day (of month)',
    value: formatOrdinal(props.tenant.rentDueDay),
    icon: CalendarDays,
    span: 'lg:col-span-3',
  },
  {
    label: 'Electricity Per Unit',
    value: `${formatINR(props.tenant.electricityRate)} / unit`,
    icon: Zap,
    span: 'lg:col-span-3',
  },
  {
    label: 'Mobile Number',
    value: formatIndianPhoneNumberNational(props.tenant.mobileNumber),
    icon: Phone,
    span: 'lg:col-span-3',
  },
  {
    label: 'Deposit Amount',
    value: formatINR(props.tenant.depositAmount),
    icon: ShieldCheck,
    span: 'lg:col-span-3',
  },
])
</script>

<template>
  <section aria-labelledby="tenant-name">
    <div class="rounded-2xl border bg-muted/40 p-4 sm:p-6">
      <div class="mb-6 flex items-center gap-4">
        <div
          class="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-primary sm:size-16"
          aria-hidden="true"
        >
          <User class="size-7 fill-current sm:size-8" />
        </div>
        <div class="min-w-0">
          <h2 id="tenant-name" class="truncate text-xl font-semibold sm:text-2xl">
            {{ tenant.name }}
          </h2>
          <p class="text-muted-foreground">Flat {{ tenant.flatNumber }}</p>
        </div>
      </div>

      <dl class="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
        <div
          v-for="item in details"
          :key="item.label"
          class="flex items-center gap-4 rounded-xl border bg-card p-4"
          :class="item.span"
        >
          <div
            class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"
            aria-hidden="true"
          >
            <component :is="item.icon" class="size-5" />
          </div>
          <div class="min-w-0">
            <dt class="text-xs text-muted-foreground">{{ item.label }}</dt>
            <dd class="mt-0.5 truncate text-base font-semibold">{{ item.value }}</dd>
          </div>
        </div>
      </dl>
    </div>

    <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
      <Button class="h-12 px-8 text-base sm:min-w-64" @click="emit('addEntry')">
        <Plus aria-hidden="true" />
        Add New Entry
      </Button>
      <Button
        variant="secondary"
        class="h-12 px-8 text-base sm:min-w-52"
        @click="emit('viewEntries')"
      >
        <History aria-hidden="true" />
        Previous Entries<template v-if="entryCount != null"> ({{ entryCount }})</template>
      </Button>
    </div>
  </section>
</template>
