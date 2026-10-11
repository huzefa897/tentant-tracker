import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import { RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { ApiError } from '@/services/apiError'
import { rentEntryService } from '@/services/rentEntry.service'
import { tenantService } from '@/services/tenant.service'
import { useAuthStore } from '@/stores/auth'
import { SAVE_UNCONFIRMED_MESSAGE } from '@/stores/rentEntry'
import { makeEntry, openPage } from '@/test/rentEntries'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))

const createEntry = vi.mocked(rentEntryService.createEntry)

let app: VueWrapper | undefined
const body = new DOMWrapper(document.body)

// Rendered through RouterView so the leave guard is registered, as it is in the app.
async function openEntryPage(tenantId = 'tenant-001') {
  signInAs()
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

function savedSummary() {
  return Object.fromEntries(
    app!
      .get('[data-testid="saved-summary"]')
      .findAll('div')
      .map((row) => [row.get('dt').text(), row.get('dd').text()]),
  )
}

const validEntry = {
  billingMonth: '2026-09',
  electricityUnits: '75',
  waterAmount: '300',
  notes: 'September charges',
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
  resetRentEntryService()
  localStorage.clear()
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 3, 12, 0))
})

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('NewRentEntryView', () => {
  it('holds the form’s shape with a skeleton while the tenant loads', async () => {
    app = await openPage('/tenants/tenant-001/entries/new', () => {
      vi.mocked(tenantService.getTenant).mockReturnValueOnce(new Promise(() => {}))
    })

    const loading = app.get('[data-testid="tenant-loading"]')
    expect(loading.attributes('role')).toBe('status')
    expect(loading.get('.sr-only').text()).toBe('Loading tenant…')
    expect(app.find('form').exists()).toBe(false)
  })

  it('loads the tenant and shows the form for the tenant in the URL', async () => {
    await openEntryPage('tenant-002')

    expect(app!.get('h1').text()).toBe('Add Rent Entry')
    expect(app!.get('[data-testid="tenant-chip"]').text()).toBe('Mohammed Yusuf · Flat 301')
    expect(app!.get<HTMLInputElement>('#rentAmount').element.value).toBe('18000')
  })

  it('saves a payment received with the bill, and confirms the backend’s balance', async () => {
    await openEntryPage()
    await fill({ ...validEntry, paymentAmount: '10000' })
    await fill({ paidDate: '2026-10-01', paymentNotes: 'Initial payment' })
    await save()

    expect(createEntry).toHaveBeenCalledWith(
      expect.any(String),
      'tenant-001',
      expect.objectContaining({
        initialPayment: { amount: 10000, paidDate: '2026-10-01', notes: 'Initial payment' },
      }),
      expect.any(String),
    )
    expect(savedSummary()).toMatchObject({
      'Total paid': '₹10,000',
      Outstanding: '₹5,750',
      Status: 'Partially paid',
    })
    expect(fakeEntries.payments).toHaveLength(1)
  })

  it('explains a payment more than the bill the backend calculated, saving neither', async () => {
    // The rate went down while the form was open: ₹15,375 due, not the ₹15,750 previewed.
    fakeEntries.rate = 1
    await openEntryPage()
    await fill({ ...validEntry, paymentAmount: '15750' })
    await fill({ paidDate: '2026-10-01' })
    await save()

    expect(app!.get('[role="alert"]').text()).toBe(
      "The payment is more than the bill's total due of ₹15,375. Check the amount and try again.",
    )
    expect(fakeEntries.entries).toEqual([])
    expect(fakeEntries.payments).toEqual([])
  })

  it('shows a message for an unknown tenant', async () => {
    await openEntryPage('nope')

    expect(app!.text()).toContain('Tenant not found')
    expect(app!.find('form').exists()).toBe(false)

    await button('Back to Dashboard').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('saves the bill through the API and confirms with the saved charges', async () => {
    await openEntryPage()
    await fill(validEntry)
    await save()

    expect(createEntry).toHaveBeenCalledWith(
      expect.any(String),
      'tenant-001',
      {
        entry: {
          tenantId: 'tenant-001',
          billingMonth: '2026-09',
          rentAmount: 15000,
          electricityUnits: 75,
          electricityRate: 6,
          waterAmount: 300,
          notes: 'September charges',
          useTenancyRent: true,
        },
        initialPayment: null,
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    )
    expect(app!.get('#entry-saved-heading').text()).toBe('Entry saved')
    expect(app!.text()).toContain('September 2026 for Shaik Zahid Ali, Flat 202')
    expect(savedSummary()).toEqual({
      'Billing month': 'September 2026',
      Rent: '₹15,000',
      'Electricity (75 units × ₹6)': '₹450',
      Water: '₹300',
      'Total due': '₹15,750',
      'Total paid': '₹0',
      Outstanding: '₹15,750',
      Status: 'Unpaid',
    })
    expect(app!.find('[data-testid="rate-changed"]').exists()).toBe(false)
    expect(app!.find('[data-testid="rent-changed"]').exists()).toBe(false)
  })

  it('charges the tenancy’s current rent when it changed during editing', async () => {
    fakeEntries.rent = 16000
    await openEntryPage()
    await fill(validEntry)
    await save()

    expect(savedSummary()).toMatchObject({ Rent: '₹16,000', 'Total due': '₹16,750' })
    expect(app!.get('[data-testid="rent-changed"]').text()).toContain('₹16,000')
  })

  it('keeps a rent the user edited, even if the tenancy’s changed', async () => {
    fakeEntries.rent = 16000
    await openEntryPage()
    await fill({ ...validEntry, rentAmount: '14000' })
    await save()

    expect(savedSummary()).toMatchObject({ Rent: '₹14,000' })
    expect(app!.find('[data-testid="rent-changed"]').exists()).toBe(false)
  })

  it('shows the backend’s charges when the rate changed during editing', async () => {
    fakeEntries.rate = 7
    await openEntryPage()
    await fill(validEntry)
    await save()

    expect(savedSummary()).toMatchObject({
      'Electricity (75 units × ₹7)': '₹525',
      'Total due': '₹15,825',
    })
    expect(app!.get('[data-testid="rate-changed"]').text()).toContain('₹7 per unit')
  })

  it('opens the saved entry from the confirmation', async () => {
    await openEntryPage()
    await fill(validEntry)
    await save()

    await button('View Entry').trigger('click')
    // The details page is lazy-loaded.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))

    expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001', entryId: 'saved-1' })
  })

  it('returns to the dashboard from the confirmation without asking', async () => {
    await openEntryPage()
    await fill(validEntry)
    await save()

    await button('Back to Dashboard').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('shows Saving… and sends one request while the save is in flight', async () => {
    let finish!: () => void
    createEntry.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(makeEntry({ id: 'slow' }))
        }),
    )
    await openEntryPage()
    await fill(validEntry)

    await app!.get('form').trigger('submit')
    await app!.get('form').trigger('submit')

    expect(button('Saving…').attributes('disabled')).toBeDefined()
    expect(createEntry).toHaveBeenCalledTimes(1)

    finish()
    await flushPromises()
    expect(app!.get('#entry-saved-heading').text()).toBe('Entry saved')
  })

  it('stays on the page while the save is in flight, with no way to discard it', async () => {
    let finish!: () => void
    createEntry.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(makeEntry({ id: 'slow', billingMonth: '2026-09' }))
        }),
    )
    await openEntryPage()
    await fill(validEntry)
    await app!.get('form').trigger('submit')

    expect(button('Cancel').attributes('disabled')).toBeDefined()
    expect(button('Back to Dashboard').attributes('disabled')).toBeDefined()
    // Any other navigation (a link, Back) is refused without offering to discard.
    await router.push('/dashboard')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('rent-entry-new')
    expect(body.find('[role="alertdialog"]').exists()).toBe(false)

    finish()
    await flushPromises()
    expect(app!.get('#entry-saved-heading').text()).toBe('Entry saved')
    expect(button('Back to Dashboard').attributes('disabled')).toBeUndefined()
  })

  it('still lets signing out leave while a save is in flight', async () => {
    createEntry.mockImplementationOnce(() => new Promise(() => {}))
    await openEntryPage()
    await fill(validEntry)
    await app!.get('form').trigger('submit')

    await useAuthStore().logout()
    await router.replace({ name: 'login' })
    await flushPromises()

    expect(router.currentRoute.value.name).not.toBe('rent-entry-new')
  })

  it('keeps the form and its values when the save fails, with no confirmation', async () => {
    createEntry.mockRejectedValueOnce(new ApiError('unavailable'))
    await openEntryPage()
    await fill(validEntry)
    await save()

    expect(app!.get('[role="alert"]').text()).toBe(SAVE_UNCONFIRMED_MESSAGE)
    expect(app!.find('#entry-saved-heading').exists()).toBe(false)
    expect(app!.get<HTMLInputElement>('#electricityUnits').element.value).toBe('75')
    expect(app!.get<HTMLTextAreaElement>('#notes').element.value).toBe('September charges')

    // Trying again works.
    await save()
    expect(app!.get('#entry-saved-heading').text()).toBe('Entry saved')
  })

  it('shows a duplicate-month error with a link to the saved entry, and keeps the form', async () => {
    fakeEntries.entries = [makeEntry({ id: 'sep', billingMonth: '2026-09' })]
    await openEntryPage()
    await fill(validEntry)
    await save()

    expect(app!.get('[role="alert"]').text()).toBe(
      'An entry already exists for this tenant and billing month.',
    )
    expect(app!.get('[data-testid="existing-entry"]').text()).toContain(
      'September 2026 already has a saved entry',
    )
    expect(fakeEntries.entries).toHaveLength(1)
    expect(app!.find('form').exists()).toBe(true)

    await button('Open saved entry').trigger('click')
    await flushPromises()
    // The form has changes, so leaving asks first.
    await button('Discard changes').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))

    expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001', entryId: 'sep' })
  })

  it('retries a save with no response with the same key, so the bill is saved once', async () => {
    // Saved on the server (with its payment), but the response never arrived.
    const create = createEntry.getMockImplementation()!
    createEntry.mockImplementationOnce(async (...args) => {
      await create(...args)
      throw new ApiError('network')
    })
    await openEntryPage()
    await fill({ ...validEntry, paymentAmount: '10000' })
    await fill({ paidDate: '2026-10-01' })
    await save()

    expect(app!.get('[role="alert"]').text()).toBe(SAVE_UNCONFIRMED_MESSAGE)
    expect(app!.find('#entry-saved-heading').exists()).toBe(false)

    await save()

    const [first, retry] = createEntry.mock.calls
    expect(retry![3]).toBe(first![3])
    expect(app!.get('#entry-saved-heading').text()).toBe('Entry saved')
    expect(fakeEntries.entries).toHaveLength(1)
    expect(fakeEntries.payments).toHaveLength(1)
  })

  it('uses a new key after a definite rejection', async () => {
    createEntry.mockRejectedValueOnce(
      new ApiError('invalid-request', 'Bad request', null, { notes: 'Too long.' }),
    )
    await openEntryPage()
    await fill(validEntry)
    await save()
    await save()

    const [first, second] = createEntry.mock.calls
    expect(second![3]).not.toBe(first![3])
  })

  it('shows the backend’s reason for a rejected month', async () => {
    createEntry.mockRejectedValueOnce(
      new ApiError('invalid-request', 'Bad request', null, {
        billingMonth: "This month is outside the tenancy's occupancy period.",
      }),
    )
    await openEntryPage()
    await fill(validEntry)
    await save()

    expect(app!.get('[role="alert"]').text()).toBe(
      "This month is outside the tenancy's occupancy period.",
    )
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
      expect(createEntry).not.toHaveBeenCalled()
    })

    it('also asks when navigating away another way', async () => {
      await openEntryPage()
      await fill({ notes: 'Paid via UPI' })

      await button('Back to Dashboard').trigger('click')
      await flushPromises()

      expect(router.currentRoute.value.name).toBe('rent-entry-new')
      expect(body.find('[role="alertdialog"]').exists()).toBe(true)
    })
  })
})

describe('NewRentEntryView when tenants fail to load', () => {
  it('shows the slow-load screen instead of Tenant not found, then auto-retries', async () => {
    vi.useFakeTimers()
    try {
      app = await openPage('/tenants/tenant-001/entries/new', () => {
        vi.mocked(tenantService.getTenant).mockRejectedValueOnce(new Error('boom'))
      })

      expect(app.text()).toContain("It's taking longer than usual")
      expect(app.text()).not.toContain('Tenant not found')
      expect(app.find('form').exists()).toBe(false)

      vi.advanceTimersByTime(10_000)
      await flushPromises()

      expect(app.find('form').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
