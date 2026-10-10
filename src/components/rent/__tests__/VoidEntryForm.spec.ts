import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import VoidEntryForm from '@/components/rent/VoidEntryForm.vue'
import { makePayment } from '@/test/rentEntries'

const REASON = 'Entered twice for October.'

function mountForm(props: Partial<InstanceType<typeof VoidEntryForm>['$props']> = {}) {
  return mount(VoidEntryForm, {
    attachTo: document.body,
    props: {
      tenant: { name: 'Shaik Zahid Ali', flatNumber: '202' },
      entry: { billingMonth: '2026-10', totalDue: 15750 },
      paymentsToReverse: [],
      ...props,
    },
  })
}

describe('VoidEntryForm', () => {
  it('shows the bill and what voiding does', () => {
    const wrapper = mountForm()

    expect(wrapper.get('[data-testid="void-entry"]').text()).toContain('October 2026')
    expect(wrapper.get('[data-testid="void-entry"]').text()).toContain('₹15,750')
    expect(wrapper.get('[data-testid="void-effects"]').text()).toContain(
      'It no longer counts towards any total or balance.',
    )
    wrapper.unmount()
  })

  it('emits the trimmed reason', async () => {
    const wrapper = mountForm()

    await wrapper.get('#void-reason').setValue(`  ${REASON}  `)
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('void')).toEqual([[REASON]])
    wrapper.unmount()
  })

  it('needs a reason, and focuses it', async () => {
    const wrapper = mountForm()

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('void')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('Say why this bill is being voided.')
    expect(document.activeElement?.id).toBe('void-reason')
    wrapper.unmount()
  })

  it('lists the payments to reverse first, and can’t be submitted until they are', async () => {
    const wrapper = mountForm({
      paymentsToReverse: [
        makePayment({
          id: 'p-1',
          amount: 5000,
          paidDate: '2026-10-05',
          receipt: { id: 'r-1', reference: 'Zahid_Rent_Oct', status: 'issued' },
        }),
        makePayment({ id: 'p-2', amount: 1000, paidDate: '2026-10-07' }),
      ],
    })

    const blocked = wrapper.get('[data-testid="payments-to-reverse"]')
    expect(blocked.text()).toContain('Reverse these 2 payments first')
    expect(blocked.findAll('[data-testid="payment-to-reverse"]').map((row) => row.text())).toEqual([
      '5 Oct 2026₹5,000 Receipt Zahid_Rent_Oct will be marked VOID.',
      '7 Oct 2026₹1,000',
    ])
    expect(blocked.text()).toContain('Reversing refunds nothing')
    expect(wrapper.find('#void-reason').exists()).toBe(false)
    expect(wrapper.findAll('button').map((b) => b.text())).toEqual(['Close'])

    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('void')).toBeUndefined()
    wrapper.unmount()
  })

  it('is disabled while voiding, and shows the save error', () => {
    const wrapper = mountForm({ saving: true, saveError: 'Unable to void the bill.' })

    expect(wrapper.get('[data-testid="fields"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Voiding…')
    expect(wrapper.text()).toContain('Unable to void the bill.')
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
