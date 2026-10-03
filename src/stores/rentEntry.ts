import { ref } from 'vue'
import { defineStore } from 'pinia'

import type { RentEntry, RentEntryInput } from '@/types/rentEntry'

// In memory only for now: entries are lost on refresh until persistence is added.
export const useRentEntryStore = defineStore('rentEntry', () => {
  const entries = ref<RentEntry[]>([])

  // One bill per tenant per month. This only checks entries in memory; the backend must
  // enforce it too once entries are persisted.
  function addEntry(input: RentEntryInput): RentEntry {
    const duplicate = entries.value.some(
      (entry) => entry.tenantId === input.tenantId && entry.billingMonth === input.billingMonth,
    )

    if (duplicate) {
      throw new Error('An entry already exists for this tenant and billing month.')
    }

    const entry: RentEntry = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }

    entries.value.push(entry)

    return entry
  }

  return {
    entries,
    addEntry,
  }
})
