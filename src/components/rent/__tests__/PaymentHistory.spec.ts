import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PaymentHistory from '@/components/rent/PaymentHistory.vue'
import { makePayment } from '@/test/rentEntries'

function cells(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('[data-testid="payment-row"]')
    .map((row) => row.findAll('td').map((cell) => cell.text()))
}

describe('PaymentHistory', () => {
  const payments = [
    makePayment({ id: 'b', paidDate: '2026-10-10', amount: 3000, notes: 'Bank transfer' }),
    makePayment({ id: 'a', paidDate: '2026-10-03', amount: 10000, notes: '' }),
  ]

  it('lists each payment’s date, amount and notes in the given order', () => {
    const wrapper = mount(PaymentHistory, { props: { payments } })

    expect(cells(wrapper)).toEqual([
      ['10 Oct 2026', '₹3,000', 'Bank transfer'],
      ['3 Oct 2026', '₹10,000', '—'],
    ])
    expect(wrapper.find('[data-testid="download-receipt"]').exists()).toBe(false)
  })

  it('offers to issue a receipt, or download the one already issued, when receipts are on', () => {
    const issued = { id: 'receipt-1', reference: 'RCT-receipt-1' }
    const wrapper = mount(PaymentHistory, {
      props: { payments: [{ ...payments[0]!, receipt: issued }, payments[1]!], receipts: true },
    })

    expect(cells(wrapper)).toEqual([
      ['10 Oct 2026', '₹3,000', 'Bank transfer', 'Download receipt'],
      ['3 Oct 2026', '₹10,000', '—', 'Issue receipt'],
    ])
  })

  it('emits download-receipt with the payment id', async () => {
    const wrapper = mount(PaymentHistory, {
      props: { payments: [makePayment({ id: 'b' }), makePayment({ id: 'a' })], receipts: true },
    })

    await wrapper.findAll('[data-testid="download-receipt"]')[1]!.trigger('click')

    expect(wrapper.emitted('download-receipt')).toEqual([['a']])
  })

  it('shows which receipt is being prepared and disables every button meanwhile', () => {
    const wrapper = mount(PaymentHistory, {
      props: {
        payments: [makePayment({ id: 'b' }), makePayment({ id: 'a' })],
        receipts: true,
        downloadingPaymentId: 'a',
      },
    })
    const buttons = wrapper.findAll('[data-testid="download-receipt"]')

    expect(buttons.map((button) => button.text())).toEqual(['Issue receipt', 'Preparing…'])
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
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
