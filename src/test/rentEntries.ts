import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import { RouterView } from 'vue-router'

import router from '@/router'
import type { RentEntry } from '@/types/rentEntry'
import { RENT_ENTRIES_STORAGE_KEY } from '@/utils/rentEntryStorage'

// A valid saved entry; tests override what they care about.
export function makeEntry(overrides: Partial<RentEntry> = {}): RentEntry {
  return {
    id: 'entry-1',
    tenantId: 'tenant-001',
    billingMonth: '2026-09',
    rentAmount: 15000,
    electricityUnits: 75,
    electricityRate: 6,
    waterAmount: 300,
    totalPaid: 0,
    paidDate: null,
    notes: '',
    createdAt: '2026-10-03T06:00:00.000Z',
    ...overrides,
  }
}

export function storeEntries(...entries: RentEntry[]) {
  localStorage.setItem(RENT_ENTRIES_STORAGE_KEY, JSON.stringify({ version: 1, entries }))
}

// Signs in and opens the URL directly, as after a refresh: fresh Pinia, nothing selected.
// Rendered through RouterView, as in the app.
export async function openPage(path: string): Promise<VueWrapper> {
  localStorage.setItem(
    'rent-tracker-auth-user',
    JSON.stringify({ id: 'mock-user-1', phoneNumber: '+918341413827' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push(path)
  const wrapper = mount(() => h(RouterView), {
    global: { plugins: [pinia, router] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}
