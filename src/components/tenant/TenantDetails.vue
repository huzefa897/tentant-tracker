<script setup lang="ts">
import { computed } from 'vue'
import { History, Plus, User } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import type { Tenant } from '@/types/tenant'
import { formatINR } from '@/utils/currency'
import { formatOrdinal } from '@/utils/date'
import { formatIndianPhoneNumberNational } from '@/utils/phone'

const props = defineProps<{
  tenant: Tenant
  // Saved bills for this tenant; null while unknown (not loaded, or loading failed).
  entryCount?: number | null
}>()

const emit = defineEmits<{
  addEntry: []
  viewEntries: []
}>()

// The tenancy's terms as one quiet list; the name and flat are the heading, never repeated.
// The mobile number is a tel: link, so it rings from a phone.
const details = computed(() => [
  { label: 'Rent', value: formatINR(props.tenant.rentAmount) },
  { label: 'Due each month', value: formatOrdinal(props.tenant.rentDueDay) },
  { label: 'Electricity', value: `${formatINR(props.tenant.electricityRate)} / unit` },
  { label: 'Deposit', value: formatINR(props.tenant.depositAmount) },
  {
    label: 'Mobile',
    value: formatIndianPhoneNumberNational(props.tenant.mobileNumber),
    href: `tel:${props.tenant.mobileNumber}`,
  },
])
</script>

<template>
  <section aria-labelledby="tenant-name">
    <div class="rounded-xl border bg-card p-4 sm:p-6">
      <div class="flex items-center gap-4">
        <div
          class="flex size-12 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"
          aria-hidden="true"
        >
          <User class="size-6" />
        </div>
        <div class="min-w-0">
          <h2 id="tenant-name" class="truncate text-xl font-semibold sm:text-2xl">
            {{ tenant.name }}
          </h2>
          <p class="text-muted-foreground">Flat {{ tenant.flatNumber }}</p>
        </div>
      </div>

      <!-- Below the name: the page fills it (the dashboard shows the latest bill). -->
      <div v-if="$slots['latest-entry']" class="mt-5">
        <slot name="latest-entry" />
      </div>

      <dl class="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-3 lg:grid-cols-5">
        <div v-for="item in details" :key="item.label" class="min-w-0">
          <dt class="text-sm text-muted-foreground">{{ item.label }}</dt>
          <dd class="mt-0.5 truncate font-semibold tabular-nums">
            <a
              v-if="item.href"
              :href="item.href"
              class="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >{{ item.value }}</a
            >
            <template v-else>{{ item.value }}</template>
          </dd>
        </div>
      </dl>

      <div class="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button class="h-11 px-6" @click="emit('addEntry')">
          <Plus aria-hidden="true" />
          New bill
        </Button>
        <Button variant="outline" class="h-11 px-6" @click="emit('viewEntries')">
          <History aria-hidden="true" />
          Bills<template v-if="entryCount != null"> ({{ entryCount }})</template>
        </Button>
      </div>
    </div>
  </section>
</template>
