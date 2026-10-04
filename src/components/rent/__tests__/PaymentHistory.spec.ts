import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PaymentHistory from '@/components/rent/PaymentHistory.vue'
import { makePayment } from '@/test/rentEntries'

describe('PaymentHistory', () => {
  it('lists each payment’s date, amount and notes in the given order', () => {
    const wrapper = mount(PaymentHistory, {
      props: {
        payments: [
          makePayment({ id: 'b', paidDate: '2026-10-10', amount: 3000, notes: 'Bank transfer' }),
          makePayment({ id: 'a', paidDate: '2026-10-03', amount: 10000, notes: '' }),
        ],
      },
    })

    const rows = wrapper
      .findAll('[data-testid="payment-row"]')
      .map((row) => row.findAll('td').map((cell) => cell.text()))

    expect(rows).toEqual([
      ['10 Oct 2026', '₹3,000', 'Bank transfer'],
      ['3 Oct 2026', '₹10,000', '—'],
    ])
  })

  it('says when there are no payments', () => {
    const wrapper = mount(PaymentHistory, { props: { payments: [] } })

    expect(wrapper.text()).toBe('No payments recorded for this entry.')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('shows notes as text, never HTML', () => {
    const wrapper = mount(PaymentHistory, {
      props: { payments: [makePayment({ notes: '<b>bold</b>' })] },
    })

    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>bold</b>')
  })
})
