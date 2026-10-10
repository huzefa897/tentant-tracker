import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ReversePaymentForm from '@/components/rent/ReversePaymentForm.vue'
import { makePayment } from '@/test/rentEntries'

const REASON = 'Entered ₹10,000 instead of ₹1,000.'

function mountForm(props: Partial<InstanceType<typeof ReversePaymentForm>['$props']> = {}) {
  return mount(ReversePaymentForm, {
    attachTo: document.body,
    props: {
      tenant: { name: 'Shaik Zahid Ali', flatNumber: '202' },
      billingMonth: '2026-09',
      payment: makePayment({ amount: 10000, paidDate: '2026-10-03' }),
      ...props,
    },
  })
}

describe('ReversePaymentForm', () => {
  it('shows the tenant, billing month, and the payment’s date and amount', () => {
    const wrapper = mountForm()

    const details = Object.fromEntries(
      wrapper
        .get('[data-testid="reversal-payment"]')
        .findAll(':scope > div')
        .map((row) => [row.get('dt').text(), row.get('dd').text()]),
    )
    expect(details).toEqual({
      Tenant: 'Shaik Zahid Ali · Flat 202',
      'Billing month': 'September 2026',
      'Paid date': '3 Oct 2026',
      Amount: '₹10,000',
    })
    wrapper.unmount()
  })

  it('warns that a receipt will be voided only when there is one', () => {
    const without = mountForm()
    expect(without.get('[data-testid="reversal-effects"]').text()).not.toContain('VOID')
    without.unmount()

    const withReceipt = mountForm({
      payment: makePayment({
        receipt: {
          id: 'r-1',
          reference: 'Shaik_Zahid_Ali_202_Rent_September 2026',
          status: 'issued',
        },
      }),
    })
    expect(withReceipt.get('[data-testid="reversal-effects"]').text()).toContain(
      'Its receipt Shaik_Zahid_Ali_202_Rent_September 2026 will be marked VOID',
    )
    withReceipt.unmount()
  })

  it('emits the trimmed reason', async () => {
    const wrapper = mountForm()

    await wrapper.get('#reversal-reason').setValue(`  ${REASON}  `)
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('reverse')).toEqual([[REASON]])
    wrapper.unmount()
  })

  it('needs a reason, and focuses it', async () => {
    const wrapper = mountForm()

    await wrapper.get('form').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('reverse')).toBeUndefined()
    expect(wrapper.get('#reversal-reason-error').text()).toBe(
      'Say why this payment is being reversed.',
    )
    expect(wrapper.get('#reversal-reason').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('#reversal-reason').element)
    wrapper.unmount()
  })

  it('locks the reason and both buttons while reversing, and shows a failure', async () => {
    const wrapper = mountForm({ saving: true, saveError: 'Only owners can reverse payments.' })

    expect(wrapper.get('[data-testid="fields"]').attributes('disabled')).toBeDefined()
    expect(
      wrapper.findAll('button').map((b) => [b.text(), b.attributes('disabled') !== undefined]),
    ).toEqual([
      ['Reversing…', true],
      ['Cancel', true],
    ])
    expect(wrapper.get('[role="alert"]').text()).toBe('Only owners can reverse payments.')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('reverse')).toBeUndefined()
    wrapper.unmount()
  })

  it('emits cancel', async () => {
    const wrapper = mountForm()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })
})
