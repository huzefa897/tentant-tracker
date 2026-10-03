import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import { RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { useRentEntryStore } from '@/stores/rentEntry'

vi.mock('@/services/auth.service', () => ({
  authService: { sendOtp: vi.fn(), verifyOtp: vi.fn(), logout: vi.fn() },
}))

let app: VueWrapper | undefined
const body = new DOMWrapper(document.body)

// Rendered through RouterView so the leave guard is registered, as it is in the app.
async function openEntryPage(tenantId = 'tenant-001') {
  localStorage.setItem(
    'rent-tracker-auth-user',
    JSON.stringify({ id: 'mock-user-1', phoneNumber: '+918341413827' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push('/dashboard')
  app = mount(() => h(RouterView), {
    global: { plugins: [pinia, router] },
    attachTo: document.body,
  })
  await router.push(`/tenants/${tenantId}/entries/new`)
  await flushPromises()
  return app
}

async function fill(values: Record<string, string>) {
  for (const [id, value] of Object.entries(values)) {
    await app!.get(`#${id}`).setValue(value)
  }
}

async function save() {
  await app!.get('form').trigger('submit')
  await flushPromises()
}

function button(label: string) {
  const match = body.findAll('button').find((b) => b.text() === label)
  if (!match) throw new Error(`No "${label}" button`)
  return match
}

const validEntry = {
  billingMonth: '2026-09',
  electricityUnits: '75',
  waterAmount: '300',
  totalPaid: '10000',
  paidDate: '2026-10-01',
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 3, 12, 0))
})

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.useRealTimers()
})

describe('NewRentEntryView', () => {
  it('loads tenants and shows the form for the tenant in the URL', async () => {
    await openEntryPage('tenant-002')

    expect(app!.get('h1').text()).toBe('Add Rent Entry')
    expect(app!.get('[data-testid="tenant-chip"]').text()).toBe('Mohammed Yusuf · Flat 301')
    expect(app!.get<HTMLInputElement>('#rentAmount').element.value).toBe('18000')
  })

  it('shows a message for an unknown tenant', async () => {
    await openEntryPage('nope')

    expect(app!.text()).toContain('Tenant not found')
    expect(app!.find('form').exists()).toBe(false)

    await button('Back to Dashboard').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('saves a valid entry and shows a confirmation', async () => {
    await openEntryPage()
    await fill(validEntry)
    await save()

    const store = useRentEntryStore()
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0]).toMatchObject({
      tenantId: 'tenant-001',
      billingMonth: '2026-09',
      rentAmount: 15000,
      electricityRate: 6,
      totalPaid: 10000,
      paidDate: '2026-10-01',
    })

    expect(app!.find('form').exists()).toBe(false)
    expect(app!.get('#entry-saved-heading').text()).toBe('Entry saved')
    const text = app!.text()
    expect(text).toContain('Shaik Zahid Ali, Flat 202')
    expect(text).toContain('September 2026')
    expect(text).toContain('₹15,750')
    expect(text).toContain('₹10,000')
    expect(text).toContain('₹5,750')
    expect(text).toContain('Partially paid')
  })

  it('returns to the dashboard from the confirmation without asking', async () => {
    await openEntryPage()
    await fill(validEntry)
    await save()

    await button('Back to Dashboard').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('shows a duplicate-entry error and keeps the form', async () => {
    await openEntryPage()
    useRentEntryStore().addEntry({
      tenantId: 'tenant-001',
      billingMonth: '2026-09',
      rentAmount: 15000,
      electricityUnits: 10,
      electricityRate: 6,
      waterAmount: 0,
      totalPaid: 0,
      paidDate: null,
      notes: '',
    })

    await fill(validEntry)
    await save()

    expect(useRentEntryStore().entries).toHaveLength(1)
    expect(app!.get('[role="alert"]').text()).toBe(
      'An entry already exists for this tenant and billing month.',
    )
    expect(app!.find('form').exists()).toBe(true)
  })

  it('cancels straight back to the dashboard when nothing changed', async () => {
    await openEntryPage()

    await button('Cancel').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('dashboard')
    expect(body.find('[role="alertdialog"]').exists()).toBe(false)
  })

  describe('with unsaved changes', () => {
    it('asks before discarding, and Keep editing stays on the form', async () => {
      await openEntryPage()
      await fill({ electricityUnits: '75' })

      await button('Cancel').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('rent-entry-new')
      expect(body.get('[role="alertdialog"]').text()).toContain('Discard this entry?')

      await button('Keep editing').trigger('click')
      await flushPromises()

      expect(body.find('[role="alertdialog"]').exists()).toBe(false)
      expect(router.currentRoute.value.name).toBe('rent-entry-new')
      expect(app!.get<HTMLInputElement>('#electricityUnits').element.value).toBe('75')
    })

    it('discards and leaves without saving', async () => {
      await openEntryPage()
      await fill({ electricityUnits: '75' })

      await button('Cancel').trigger('click')
      await flushPromises()
      await button('Discard changes').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('dashboard')
      expect(useRentEntryStore().entries).toEqual([])
    })

    it('also asks when navigating away another way', async () => {
      await openEntryPage()
      await fill({ notes: 'Paid via UPI' })

      await button('Dashboard').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('rent-entry-new')
      expect(body.find('[role="alertdialog"]').exists()).toBe(true)
    })
  })
})
