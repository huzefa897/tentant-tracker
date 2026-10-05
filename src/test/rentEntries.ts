import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import { RouterView } from 'vue-router'

import router from '@/router'
import { signInAs } from '@/test/mocks/authService'
import type { Payment } from '@/types/payment'
import type { PaymentReceipt } from '@/types/receipt'
import type { RentEntry } from '@/types/rentEntry'
import { RENT_LEDGER_STORAGE_KEY } from '@/utils/rentLedgerStorage'

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
    notes: '',
    createdAt: '2026-10-03T06:00:00.000Z',
    ...overrides,
  }
}

// A valid saved payment against entry-1; tests override what they care about.
export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    entryId: 'entry-1',
    amount: 10000,
    paidDate: '2026-10-03',
    notes: '',
    createdAt: '2026-10-03T06:00:00.000Z',
    ...overrides,
  }
}

// A valid saved receipt for payment-1 against entry-1 (the make* defaults: ₹10,000 of a
// ₹15,750 bill); tests override what they care about.
export function makeReceipt(overrides: Partial<PaymentReceipt> = {}): PaymentReceipt {
  return {
    id: 'receipt-1',
    reference: 'RCP-202-202609',
    paymentId: 'payment-1',
    entryId: 'entry-1',
    issuedAt: '2026-10-03T07:00:00.000Z',
    issuedDate: '2026-10-03',
    issuer: {
      name: 'Saleem Towers',
      managerName: 'Test Manager',
      address: '1 Example Road\nHyderabad',
      contactNumber: '',
      email: '',
    },
    tenant: {
      name: 'Shaik Zahid Ali',
      flatNumber: '202',
      mobileNumber: '+918341413827',
      depositAmount: 90000,
    },
    billingMonth: '2026-09',
    rentDueDay: 11,
    charges: { rentAmount: 15000, electricityUnits: 75, electricityRate: 6, waterAmount: 300 },
    totalDue: 15750,
    totalPaid: 10000,
    outstanding: 5750,
    previousMonthOutstanding: 0,
    paymentAmount: 10000,
    paidDate: '2026-10-03',
    paymentNotes: '',
    ...overrides,
  }
}

// Writes a version 3 ledger, as the app saves it.
export function storeLedger(
  entries: RentEntry[],
  payments: Payment[] = [],
  receipts: PaymentReceipt[] = [],
) {
  localStorage.setItem(
    RENT_LEDGER_STORAGE_KEY,
    JSON.stringify({ version: 3, entries, payments, receipts }),
  )
}

export function storeEntries(...entries: RentEntry[]) {
  storeLedger(entries)
}

// Signs in and opens the URL directly, as after a refresh: fresh Pinia, nothing selected.
// Rendered through RouterView, as in the app.
// `beforeMount` runs with the fresh Pinia active, e.g. to stub a store action.
// Signs in through the fake auth service: the calling test file must mock
// '@/services/auth.service' and '@/services/access.service' with '@/test/mocks/*'.
export async function openPage(path: string, beforeMount?: () => void): Promise<VueWrapper> {
  signInAs()
  const pinia = createPinia()
  setActivePinia(pinia)
  beforeMount?.()
  await router.push(path)
  const wrapper = mount(() => h(RouterView), {
    global: { plugins: [pinia, router] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}
