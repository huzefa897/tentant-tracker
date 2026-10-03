import { ref } from 'vue'
import { defineStore } from 'pinia'

import type { RentEntry, RentEntryInput } from '@/types/rentEntry'
import { toDateValue } from '@/utils/date'
import { loadRentEntries, saveRentEntries } from '@/utils/rentEntryStorage'
import { validateRentEntryInput } from '@/utils/rentEntryValidation'

export const LOAD_ERROR_MESSAGE = 'Saved entries could not be loaded. Please retry.'
export const SAVE_ERROR_MESSAGE =
  'Unable to save on this device. Your form has been kept open. Please try again.'

// Entries persist in localStorage (utils/rentEntryStorage.ts) until there's a backend.
export const useRentEntryStore = defineStore('rentEntry', () => {
  const entries = ref<RentEntry[]>([])
  const initialized = ref(false)
  const loadError = ref<string | null>(null)

  // Safe to call from every page that needs entries; also the Retry action after a failure.
  function initialize() {
    if (initialized.value) return

    loadError.value = null

    try {
      entries.value = loadRentEntries()
      initialized.value = true
    } catch {
      // Stored data is left untouched, and saving stays blocked until a load succeeds.
      loadError.value = LOAD_ERROR_MESSAGE
    }
  }

  function getEntriesForTenant(tenantId: string): RentEntry[] {
    return entries.value.filter((entry) => entry.tenantId === tenantId)
  }

  function addEntry(input: RentEntryInput): RentEntry {
    // Saving without the stored entries would overwrite them.
    if (!initialized.value || loadError.value) {
      throw new Error('Saved entries must load successfully before adding an entry.')
    }

    if (Object.keys(validateRentEntryInput(input, toDateValue(new Date()))).length > 0) {
      throw new Error('This entry is not valid. Check the form and try again.')
    }

    // One bill per tenant per month. The backend must enforce this too once it exists.
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

    const nextEntries = [...entries.value, entry]

    // Write first: only a successful write updates state and lets the page confirm.
    try {
      saveRentEntries(nextEntries)
    } catch {
      throw new Error(SAVE_ERROR_MESSAGE)
    }

    entries.value = nextEntries

    return entry
  }

  return {
    entries,
    initialized,
    loadError,
    initialize,
    getEntriesForTenant,
    addEntry,
  }
})
