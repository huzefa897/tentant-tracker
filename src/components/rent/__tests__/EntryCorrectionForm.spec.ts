import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EntryCorrectionForm from '@/components/rent/EntryCorrectionForm.vue'
import { makeEntry, makePayment } from '@/test/rentEntries'

// October, with 750 units instead of 75: ₹19,800.
const original = makeEntry({
  id: 'oct',
  billingMonth: '2026-10',
  electricityUnits: 750,
  electricityRate: 6,
  notes: 'October',
})

function mountForm(props: Partial<InstanceType<typeof EntryCorrectionForm>['$props']> = {}) {
  return mount(EntryCorrectionForm, {
    attachTo: document.body,
    props: { original, paymentsToReverse: [], ...props },
  })
}

describe('EntryCorrectionForm', () => {
  it('starts from the original’s values, shown beside each field, with its month and rate', () => {
    const wrapper = mountForm()

    expect((wrapper.get('#correction-rentAmount').element as HTMLInputElement).value).toBe('15000')
    expect((wrapper.get('#correction-electricityUnits').element as HTMLInputElement).value).toBe(
      '750',
    )
    expect((wrapper.get('#correction-waterAmount').element as HTMLInputElement).value).toBe('300')
    expect((wrapper.get('#correction-notes').element as HTMLTextAreaElement).value).toBe('October')
    expect(wrapper.findAll('[data-testid="original-value"]').map((v) => v.text())).toEqual([
      'Original: ₹15,000',
      'Original: 750',
      'Original: ₹300',
    ])
    expect(wrapper.text()).toContain('October 2026 · Electricity rate ₹6 / unit')
    wrapper.unmount()
  })

  it('shows the original total and the replacement’s as it’s edited', async () => {
    const wrapper = mountForm()
    const totals = () => wrapper.get('[data-testid="correction-totals"]').text()
    expect(totals()).toContain('₹19,800')

    await wrapper.get('#correction-electricityUnits').setValue('75')

    expect(totals()).toContain('₹19,800')
    expect(wrapper.get('[data-testid="replacement-total"]').text()).toBe('₹15,750')
  })

  it('emits the correction, trimmed', async () => {
    const wrapper = mountForm()

    await wrapper.get('#correction-electricityUnits').setValue('75')
    await wrapper.get('#correction-reason').setValue(' Units were wrong ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          rentAmount: 15000,
          electricityUnits: 75,
          waterAmount: 300,
          notes: 'October',
          reason: 'Units were wrong',
        },
      ],
    ])
    wrapper.unmount()
  })

  it('needs a reason and a change', async () => {
    const wrapper = mountForm()

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
    const alerts = wrapper.findAll('[role="alert"]').map((a) => a.text())
    expect(alerts).toContain('Say why this bill is being voided.')
    expect(alerts).toContain('Change at least one charge or the notes.')
    expect(document.activeElement?.id).toBe('correction-reason')
    wrapper.unmount()
  })

  it('checks the charges like a new bill', async () => {
    const wrapper = mountForm()

    await wrapper.get('#correction-rentAmount').setValue('0')
    await wrapper.get('#correction-reason').setValue('Rent was wrong')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('Enter a rent amount greater than zero.')
    wrapper.unmount()
  })

  it('lists the payments to reverse first, and can’t be submitted until they are', async () => {
    const wrapper = mountForm({ paymentsToReverse: [makePayment({ amount: 5000 })] })

    expect(wrapper.get('[data-testid="payments-to-reverse"]').text()).toContain(
      "Reverse this payment first. A bill with payments that count can't be corrected.",
    )
    expect(wrapper.get('[data-testid="fields"]').attributes('disabled')).toBeDefined()
    const submit = wrapper.findAll('button').find((b) => b.text() === 'Correct bill')!
    expect(submit.attributes('disabled')).toBeDefined()

    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })

  it('is disabled while correcting, and shows the save error', () => {
    const wrapper = mountForm({ saving: true, saveError: 'Unable to correct the bill.' })

    expect(wrapper.get('[data-testid="fields"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Correcting…')
    expect(wrapper.text()).toContain('Unable to correct the bill.')
    wrapper.unmount()
  })
})
