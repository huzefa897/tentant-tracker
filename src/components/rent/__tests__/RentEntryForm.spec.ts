import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RentEntryForm from '@/components/rent/RentEntryForm.vue'
import type { Tenant } from '@/types/tenant'

const tenant: Tenant = {
  id: 'tenant-001',
  name: 'Shaik Zahid Ali',
  flatNumber: '202',
  rentAmount: 15000,
  rentDueDay: 11,
  electricityRate: 6,
  mobileNumber: '+918341413827',
  depositAmount: 90000,
  startDate: '2025-04-01',
  endDate: null,
}

let wrapper: VueWrapper | undefined

// Payments on by default here, so the payment rules stay covered for when the backend takes
// payments (BE Phase 5); the 'payments unavailable' tests turn them off.
function mountForm(
  props: { saveError?: string | null; saving?: boolean; paymentsEnabled?: boolean } = {},
) {
  wrapper = mount(RentEntryForm, {
    props: { tenant, paymentsEnabled: true, ...props },
    attachTo: document.body,
  })
  return wrapper
}

function text(testId: string) {
  return wrapper!.get(`[data-testid="${testId}"]`).text()
}

async function fill(values: Record<string, string>) {
  for (const [id, value] of Object.entries(values)) {
    await wrapper!.get(`#${id}`).setValue(value)
  }
}

async function save() {
  await wrapper!.get('form').trigger('submit')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 3, 12, 0))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

describe('RentEntryForm', () => {
  describe('defaults', () => {
    it('starts from the current month and the tenant’s rent and rate', () => {
      mountForm()

      expect(wrapper!.get<HTMLInputElement>('#billingMonth').element.value).toBe('2026-10')
      expect(wrapper!.get<HTMLInputElement>('#rentAmount').element.value).toBe('15000')
      expect(wrapper!.get<HTMLInputElement>('#electricityUnits').element.value).toBe('')
      expect(wrapper!.get<HTMLInputElement>('#waterAmount').element.value).toBe('0')
      expect(wrapper!.get<HTMLInputElement>('#paymentAmount').element.value).toBe('0')
      expect(wrapper!.get<HTMLTextAreaElement>('#notes').element.value).toBe('')
      expect(text('rate')).toBe('₹6 / unit')
    })

    it('does not let the electricity rate be edited', () => {
      mountForm()

      expect(wrapper!.find('input#electricityRate').exists()).toBe(false)
    })

    it('shows — for totals until electricity units are entered', () => {
      mountForm()

      expect(text('electricity-amount')).toBe('—')
      expect(text('total-due')).toBe('—')
      expect(text('outstanding')).toBe('—')
      expect(text('status')).toBe('—')
    })

    it('disables the paid date while nothing is paid', () => {
      mountForm()

      expect(wrapper!.get('#paidDate').attributes('disabled')).toBeDefined()
    })
  })

  describe('live summary', () => {
    it('calculates the total due', async () => {
      mountForm()
      await fill({ electricityUnits: '75', waterAmount: '300' })

      expect(text('electricity-amount')).toBe('₹450')
      expect(text('summary')).toContain('Electricity: 75 × ₹6')
      expect(text('total-due')).toBe('₹15,750')
    })

    it('treats 0 units as no consumption', async () => {
      mountForm()
      await fill({ electricityUnits: '0' })

      expect(text('electricity-amount')).toBe('₹0')
      expect(text('total-due')).toBe('₹15,000')
    })

    it('shows Unpaid with the full amount outstanding when nothing is paid', async () => {
      mountForm()
      await fill({ electricityUnits: '75', waterAmount: '300' })

      expect(text('status')).toBe('Unpaid')
      expect(text('outstanding')).toBe('₹15,750')
    })

    it('shows Partially paid for a part payment', async () => {
      mountForm()
      await fill({ electricityUnits: '75', waterAmount: '300', paymentAmount: '10000' })

      expect(text('status')).toBe('Partially paid')
      expect(text('outstanding')).toBe('₹5,750')
    })

    it('shows Paid when the total due is paid', async () => {
      mountForm()
      await fill({ electricityUnits: '75', waterAmount: '300', paymentAmount: '15750' })

      expect(text('status')).toBe('Paid')
      expect(text('outstanding')).toBe('₹0')
    })

    it('shows — instead of a misleading total when a charge is cleared', async () => {
      mountForm()
      await fill({ electricityUnits: '75', rentAmount: '' })

      expect(text('total-due')).toBe('—')
      expect(text('outstanding')).toBe('—')
    })

    it('shows — for outstanding when the payment exceeds the total', async () => {
      mountForm()
      await fill({ electricityUnits: '75', waterAmount: '300', paymentAmount: '16000' })

      expect(text('outstanding')).toBe('—')
      expect(text('status')).toBe('—')
    })
  })

  describe('validation', () => {
    it('does not show errors before a field is touched', () => {
      mountForm()

      expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    })

    it('shows a field’s error once it has been left', async () => {
      mountForm()
      await wrapper!.get('#electricityUnits').trigger('blur')

      expect(wrapper!.get('#electricityUnits-error').text()).toBe(
        'Enter electricity units, or use 0 if there was no consumption.',
      )
      expect(wrapper!.get('#electricityUnits').attributes('aria-invalid')).toBe('true')
    })

    it('blocks saving and shows every error when Save is clicked', async () => {
      mountForm()
      await fill({ rentAmount: '0' })
      await save()

      expect(wrapper!.emitted('save')).toBeUndefined()
      expect(wrapper!.get('#rentAmount-error').text()).toBe(
        'Enter a rent amount greater than zero.',
      )
      expect(wrapper!.find('#electricityUnits-error').exists()).toBe(true)
    })

    it('focuses the first invalid field', async () => {
      mountForm()
      await save()
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('electricityUnits'))
    })

    it('blocks a payment greater than the total due', async () => {
      mountForm()
      await fill({
        electricityUnits: '75',
        waterAmount: '300',
        paymentAmount: '16000',
        paidDate: '2026-10-01',
      })
      await save()

      expect(wrapper!.emitted('save')).toBeUndefined()
      expect(wrapper!.get('#paymentAmount-error').text()).toBe(
        'Amount cannot exceed the outstanding ₹15,750.',
      )
    })

    it('requires a paid date once something is paid', async () => {
      mountForm()
      await fill({ electricityUnits: '75', paymentAmount: '5000' })

      expect(wrapper!.get('#paidDate').attributes('disabled')).toBeUndefined()

      await save()

      expect(wrapper!.emitted('save')).toBeUndefined()
      expect(wrapper!.get('#paidDate-error').text()).toBe(
        'Select the date this payment was received.',
      )
    })

    it('rejects a paid date in the future', async () => {
      mountForm()
      await fill({ electricityUnits: '75', paymentAmount: '5000', paidDate: '2026-10-04' })
      await save()

      expect(wrapper!.get('#paidDate-error').text()).toBe('Paid date cannot be in the future.')
      expect(wrapper!.get('#paidDate').attributes('max')).toBe('2026-10-03')
    })
  })

  describe('saving', () => {
    it('emits an unpaid bill with no initial payment', async () => {
      mountForm()
      await fill({ billingMonth: '2026-09', electricityUnits: '75', waterAmount: '300' })
      await save()

      expect(wrapper!.emitted('save')).toEqual([
        [
          {
            entry: {
              tenantId: 'tenant-001',
              billingMonth: '2026-09',
              rentAmount: 15000,
              electricityUnits: 75,
              electricityRate: 6,
              waterAmount: 300,
              notes: '',
            },
            initialPayment: null,
          },
        ],
      ])
    })

    it('emits the bill and its initial payment separately, each with its own notes', async () => {
      mountForm()
      await fill({
        billingMonth: '2026-09',
        electricityUnits: '75',
        waterAmount: '300',
        notes: ' Meter read on the 1st ',
        paymentAmount: '10000',
      })
      await fill({ paidDate: '2026-10-02', paymentNotes: ' Paid via UPI ' })
      await save()

      expect(wrapper!.emitted('save')![0]![0]).toMatchObject({
        entry: { billingMonth: '2026-09', notes: 'Meter read on the 1st' },
        initialPayment: { amount: 10000, paidDate: '2026-10-02', notes: 'Paid via UPI' },
      })
    })

    it('rejects a payment with more than two decimal places', async () => {
      mountForm()
      await fill({ electricityUnits: '75', paymentAmount: '100.005', paidDate: '2026-10-02' })
      await save()

      expect(wrapper!.emitted('save')).toBeUndefined()
      expect(wrapper!.get('#paymentAmount-error').text()).toBe(
        'Amount can have at most two decimal places.',
      )
    })

    it('sends no payment once the amount is set back to 0', async () => {
      mountForm()
      await fill({ electricityUnits: '75', paymentAmount: '100', paidDate: '2026-10-02' })
      await fill({ paymentAmount: '0' })

      expect(wrapper!.get<HTMLInputElement>('#paidDate').element.value).toBe('')

      await save()

      expect(wrapper!.emitted('save')![0]![0]).toMatchObject({ initialPayment: null })
    })

    it('keeps the entry’s own rent when it is changed', async () => {
      mountForm()
      await fill({ rentAmount: '16000', electricityUnits: '10' })
      await save()

      expect(wrapper!.emitted('save')![0]![0]).toMatchObject({ entry: { rentAmount: 16000 } })
    })

    it('shows a save error from the parent', () => {
      mountForm({ saveError: 'An entry already exists for this tenant and billing month.' })

      expect(wrapper!.get('[role="alert"]').text()).toBe(
        'An entry already exists for this tenant and billing month.',
      )
    })
  })

  describe('cancel and changes', () => {
    it('emits cancel without saving', async () => {
      mountForm()
      await wrapper!.get('button[type="button"]').trigger('click')

      expect(wrapper!.emitted('cancel')).toHaveLength(1)
      expect(wrapper!.emitted('save')).toBeUndefined()
    })

    it('reports when the form becomes dirty and clean again', async () => {
      mountForm()
      await fill({ notes: 'x' })
      await fill({ notes: '' })

      expect(wrapper!.emitted('dirtyChange')).toEqual([[true], [false]])
    })
  })

  describe('payments unavailable', () => {
    it('disables the payment inputs and says why', async () => {
      mountForm({ paymentsEnabled: false })

      expect(wrapper!.get('#paymentAmount').attributes('disabled')).toBeDefined()
      expect(wrapper!.get('#paidDate').attributes('disabled')).toBeDefined()
      expect(text('payments-unavailable')).toContain("Payments can't be recorded yet.")
    })

    it('previews the bill as unpaid and saves it without a payment', async () => {
      mountForm({ paymentsEnabled: false })

      await fill({ electricityUnits: '75', waterAmount: '300' })
      expect(text('total-due')).toBe('₹15,750')
      expect(text('outstanding')).toBe('₹15,750')
      expect(text('status')).toBe('Unpaid')

      await save()

      expect(wrapper!.emitted('save')).toEqual([
        [
          {
            entry: {
              tenantId: tenant.id,
              billingMonth: '2026-10',
              rentAmount: 15000,
              electricityUnits: 75,
              electricityRate: 6,
              waterAmount: 300,
              notes: '',
            },
            initialPayment: null,
          },
        ],
      ])
    })
  })

  describe('while saving', () => {
    it('disables Save and ignores another submit', async () => {
      mountForm({ saving: true })
      await fill({ electricityUnits: '75' })

      await save()

      const button = wrapper!.get('button[type="submit"]')
      expect(button.text()).toBe('Saving…')
      expect(button.attributes('disabled')).toBeDefined()
      expect(wrapper!.emitted('save')).toBeUndefined()
    })
  })
})
