<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { type RouteLocationRaw, useRouter } from 'vue-router'
import { ArrowLeft, Printer } from '@lucide/vue'

import PaymentReceiptDocument from '@/components/receipt/PaymentReceiptDocument.vue'
import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'
import { Button } from '@/components/ui/button'
import AppLayout from '@/layouts/AppLayout.vue'
import { useRentEntryStore } from '@/stores/rentEntry'

const props = defineProps<{
  tenantId: string
  entryId: string
  receiptId: string
  // The page that opened the receipt (`?from=`); anything else goes back to the entry.
  from?: unknown
}>()

const rentEntryStore = useRentEntryStore()
const router = useRouter()

onMounted(() => rentEntryStore.initialize())

// Shown only when the URL's tenant, entry and receipt all belong together, so a receipt never
// shows under another entry or tenant. Navigation consistency only: a backend must authorise
// access once data is shared.
const receipt = computed(() => {
  const found = rentEntryStore.getReceipt(props.receiptId)
  if (!found || found.entryId !== props.entryId) return null

  const entry = rentEntryStore.entries.find((item) => item.id === found.entryId)
  if (!entry || entry.tenantId !== props.tenantId) return null

  return found
})

// Opens the browser's print dialog; the user picks a printer or "Save as PDF". Whether
// anything was printed or saved can't be known, so nothing claims it was. The ledger is
// untouched.
function printReceipt() {
  window.print()
}

// Back goes to the page the receipt was opened from. Explicit routes, not router.back(): a
// direct link has no in-app page to go back to. The new-entry confirmation can't be reopened,
// so receipts opened from it go back to the dashboard.
const back = computed<{ label: string; to: RouteLocationRaw }>(() => {
  if (props.from === 'history') {
    return {
      label: 'Back to Previous Entries',
      to: { name: 'rent-entry-history', params: { tenantId: props.tenantId } },
    }
  }

  if (props.from === 'new-entry') {
    return { label: 'Back to Dashboard', to: { name: 'dashboard' } }
  }

  return {
    label: 'Back to Entry',
    to: {
      name: 'rent-entry-details',
      params: { tenantId: props.tenantId, entryId: props.entryId },
    },
  }
})

function goBack() {
  router.push(back.value.to)
}

function goToEntry() {
  router.push({
    name: 'rent-entry-details',
    params: { tenantId: props.tenantId, entryId: props.entryId },
  })
}
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <Button variant="ghost" class="h-11 text-muted-foreground" @click="goBack">
        <ArrowLeft aria-hidden="true" />
        {{ back.label }}
      </Button>
    </template>

    <RentEntriesLoadError
      v-if="rentEntryStore.loadError"
      :message="rentEntryStore.loadError"
      @retry="rentEntryStore.initialize"
    />

    <p v-else-if="!rentEntryStore.initialized" class="text-muted-foreground" role="status">
      Loading receipt…
    </p>

    <div
      v-else-if="!receipt"
      class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-14 text-center"
      role="alert"
    >
      <h1 class="text-lg font-semibold">Receipt not found</h1>
      <p class="mt-1 max-w-sm text-sm text-muted-foreground">
        This receipt doesn't exist for this entry. Open the entry to see its payments and receipts.
      </p>
      <Button class="mt-6 h-11 px-6" @click="goToEntry">Back to Entry</Button>
    </div>

    <template v-else>
      <div class="receipt-toolbar mb-6 flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground">
          Opens your browser's print dialog, where you can print or choose “Save as PDF”.
        </p>
        <Button class="h-11" @click="printReceipt">
          <Printer aria-hidden="true" />
          Print / Save as PDF
        </Button>
      </div>

      <PaymentReceiptDocument :receipt="receipt" />
    </template>
  </AppLayout>
</template>
