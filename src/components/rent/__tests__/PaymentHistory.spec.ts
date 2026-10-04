import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PaymentHistory from '@/components/rent/PaymentHistory.vue'
import { makePayment, makeReceipt } from '@/test/rentEntries'

function cells(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('[data-testid="payment-row"]')
    .map((row) => row.findAll('td').map((cell) => cell.text()))
}

describe('PaymentHistory', () => {
  it('lists each payment’s date, amount, notes and receipt action in the given order', () => {
    const wrapper = mount(PaymentHistory, {
      props: {
        payments: [
          makePayment({ id: 'b', paidDate: '2026-10-10', amount: 3000, notes: 'Bank transfer' }),
          makePayment({ id: 'a', paidDate: '2026-10-03', amount: 10000, notes: '' }),
        ],
        receipts: [makeReceipt({ paymentId: 'b' })],
      },
    })

    expect(cells(wrapper)).toEqual([
      ['10 Oct 2026', '₹3,000', 'Bank transfer', 'View receipt'],
      ['3 Oct 2026', '₹10,000', '—', 'Issue receipt'],
    ])
  })

  it('emits issue-receipt with the payment id for a payment without a receipt', async () => {
    const wrapper = mount(PaymentHistory, {
      props: { payments: [makePayment({ id: 'a' })], receipts: [] },
    })

    await wrapper.get('[data-testid="issue-receipt"]').trigger('click')

    expect(wrapper.emitted('issue-receipt')).toEqual([['a']])
  })

  it('emits view-receipt with the payment’s receipt', async () => {
    const receipt = makeReceipt({ paymentId: 'a' })
    const wrapper = mount(PaymentHistory, {
      props: { payments: [makePayment({ id: 'a' })], receipts: [receipt] },
    })

    await wrapper.get('[data-testid="view-receipt"]').trigger('click')

    expect(wrapper.emitted('view-receipt')).toEqual([[receipt]])
    expect(wrapper.find('[data-testid="issue-receipt"]').exists()).toBe(false)
  })

  it('disables Issue receipt while a receipt is being issued', () => {
    const wrapper = mount(PaymentHistory, {
      props: { payments: [makePayment()], receipts: [], issuing: true },
    })

    expect(wrapper.get('[data-testid="issue-receipt"]').attributes('disabled')).toBeDefined()
  })

  it('says when there are no payments', () => {
    const wrapper = mount(PaymentHistory, { props: { payments: [], receipts: [] } })

    expect(wrapper.text()).toBe('No payments recorded for this entry.')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('shows notes as text, never HTML', () => {
    const wrapper = mount(PaymentHistory, {
      props: { payments: [makePayment({ notes: '<b>bold</b>' })], receipts: [] },
    })

    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>bold</b>')
  })
})
