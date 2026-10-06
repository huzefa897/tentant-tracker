import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RecordPaymentForm from '@/components/rent/RecordPaymentForm.vue'
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

function mountForm(props: { outstanding?: number; saving?: boolean; saveError?: string } = {}) {
  wrapper = mount(RecordPaymentForm, {
    props: { tenant, entryId: 'entry-1', billingMonth: '2026-09', outstanding: 5750, ...props },
    attachTo: document.body,
  })
  return wrapper
}

function text(testId: string) {
  return wrapper!.get(`[data-testid="${testId}"]`).text()
}

async function fill(values: Record<string, string>) {
  for (const [field, value] of Object.entries(values)) {
    await wrapper!.get(`#payment-${field}`).setValue(value)
  }
}

async function save() {
  await wrapper!.get('form').trigger('submit')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // 00:30 local on 3 Oct: UTC would still be 2 Oct in India.
  vi.setSystemTime(new Date(2026, 9, 3, 0, 30))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

describe('RecordPaymentForm', () => {
  it('shows the tenant, billing month and outstanding amount', () => {
    mountForm()

    expect(text('payment-bill')).toContain('Shaik Zahid Ali · Flat 202')
    expect(text('payment-bill')).toContain('September 2026')
    expect(text('payment-bill')).toContain('Outstanding₹5,750')
  })

  it('starts with an empty amount, today’s local date and no notes', () => {
    mountForm()

    expect(wrapper!.get<HTMLInputElement>('#payment-amount').element.value).toBe('')
    expect(wrapper!.get<HTMLInputElement>('#payment-paidDate').element.value).toBe('2026-10-03')
    expect(wrapper!.get('#payment-paidDate').attributes('max')).toBe('2026-10-03')
    expect(wrapper!.get<HTMLTextAreaElement>('#payment-notes').element.value).toBe('')
  })

  describe('projected balance', () => {
    it('shows — before an amount is entered', () => {
      mountForm()

      expect(text('preview-payment')).toBe('—')
      expect(text('preview-remaining')).toBe('—')
    })

    it('shows what will remain after the payment', async () => {
      mountForm()
      await fill({ amount: '3000' })

      expect(text('payment-preview')).toContain('Current outstanding₹5,750')
      expect(text('preview-payment')).toBe('₹3,000')
      expect(text('preview-remaining')).toBe('₹2,750')
    })

    it('shows ₹0 remaining for the exact outstanding amount', async () => {
      mountForm()
      await fill({ amount: '5750' })

      expect(text('preview-remaining')).toBe('₹0')
    })

    it.each(['0', '-5', '10.005'])('shows — for an invalid amount (%s)', async (amount) => {
      mountForm()
      await fill({ amount })

      expect(text('preview-remaining')).toBe('—')
    })

    it('shows — and an error straight away when the payment exceeds outstanding', async () => {
      mountForm()
      await fill({ amount: '6000' })

      expect(text('preview-remaining')).toBe('—')
      expect(wrapper!.get('#payment-amount-error').text()).toBe(
        'Amount cannot exceed the outstanding ₹5,750.',
      )
    })
  })

  describe('validation', () => {
    it('does not show errors before a field is touched', () => {
      mountForm()

      expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    })

    it('blocks saving without an amount and focuses it', async () => {
      mountForm()
      await save()

      expect(wrapper!.emitted('save')).toBeUndefined()
      expect(wrapper!.get('#payment-amount-error').text()).toBe('Enter the amount received.')
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('payment-amount'))
    })

    it('blocks a payment over the outstanding amount', async () => {
      mountForm()
      await fill({ amount: '6000' })
      await save()

      expect(wrapper!.emitted('save')).toBeUndefined()
    })

    it('rejects a paid date in the future', async () => {
      mountForm()
      await fill({ amount: '100', paidDate: '2026-10-04' })
      await save()

      expect(wrapper!.emitted('save')).toBeUndefined()
      expect(wrapper!.get('#payment-paidDate-error').text()).toBe(
        'Paid date cannot be in the future.',
      )
    })

    it('requires a paid date', async () => {
      mountForm()
      await fill({ amount: '100', paidDate: '' })
      await save()

      expect(wrapper!.get('#payment-paidDate-error').text()).toBe(
        'Select the date this payment was received.',
      )
    })
  })

  describe('saving', () => {
    it('emits the payment, with trimmed notes', async () => {
      mountForm()
      await fill({ amount: '3000', paidDate: '2026-10-02', notes: ' Bank transfer ' })
      await save()

      // The page adds the idempotency key: it keeps it across a retry.
      expect(wrapper!.emitted('save')).toEqual([
        [{ entryId: 'entry-1', amount: 3000, paidDate: '2026-10-02', notes: 'Bank transfer' }],
      ])
    })

    it('keeps the entered values after a failed save', async () => {
      mountForm()
      await fill({ amount: '3000', notes: 'Cash' })
      await save()
      await wrapper!.setProps({ saveError: 'Unable to save the payment.' })

      expect(wrapper!.get('[role="alert"]').text()).toBe('Unable to save the payment.')
      expect((wrapper!.get('#payment-amount').element as HTMLInputElement).value).toBe('3000')
      expect((wrapper!.get('#payment-notes').element as HTMLTextAreaElement).value).toBe('Cash')
    })

    it('disables Save and ignores submits while saving', async () => {
      mountForm({ saving: true })
      await fill({ amount: '3000' })
      await save()

      expect(wrapper!.get('button[type="submit"]').attributes('disabled')).toBeDefined()
      expect(wrapper!.get('button[type="submit"]').text()).toBe('Saving…')
      expect(wrapper!.emitted('save')).toBeUndefined()
    })

    it('disables Cancel while saving', () => {
      mountForm({ saving: true })

      expect(wrapper!.get('button[type="button"]').attributes('disabled')).toBeDefined()
    })

    it('shows a save error from the parent and keeps the values', async () => {
      mountForm()
      await fill({ amount: '3000' })
      await wrapper!.setProps({ saveError: 'Unable to save on this device.' })

      expect(wrapper!.get('[role="alert"]').text()).toBe('Unable to save on this device.')
      expect(wrapper!.get<HTMLInputElement>('#payment-amount').element.value).toBe('3000')
    })

    it('emits cancel without saving', async () => {
      mountForm()
      await wrapper!.get('button[type="button"]').trigger('click')

      expect(wrapper!.emitted('cancel')).toHaveLength(1)
      expect(wrapper!.emitted('save')).toBeUndefined()
    })
  })
})
