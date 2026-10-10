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
    const issued = {
      id: 'receipt-1',
      reference: 'Shaik_Zahid_Ali_202_Rent_October 2026',
      status: 'issued' as const,
    }
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

  describe('reversed payments', () => {
    const reversal = {
      id: 'rev-1',
      reason: 'Entered ₹10,000 instead of ₹1,000.',
      createdAt: '2026-10-07T08:00:00Z',
      createdByName: 'Huzefa',
    }
    const reversed = makePayment({
      id: 'a',
      amount: 10000,
      status: 'reversed',
      reversal,
      receipt: { id: 'r-1', reference: 'Shaik_Zahid_Ali_202_Rent_October 2026', status: 'void' },
    })

    it('keeps a reversed payment, marked, with who reversed it and why', () => {
      const wrapper = mount(PaymentHistory, { props: { payments: [reversed] } })
      const row = wrapper.get('[data-testid="payment-row"]')

      expect(row.attributes('data-status')).toBe('reversed')
      expect(row.get('[data-testid="reversed-badge"]').text()).toBe('Reversed')
      expect(row.get('[data-testid="reversal-reason"]').text()).toContain('Reversed by Huzefa on')
      expect(row.get('[data-testid="reversal-reason"]').text()).toContain(reversal.reason)
      expect(wrapper.get('[data-testid="reversed-note"]').text()).toContain(
        "don't count towards Total paid",
      )
    })

    it('says nothing of reversals when there are none', () => {
      const wrapper = mount(PaymentHistory, { props: { payments } })

      expect(wrapper.find('[data-testid="reversed-note"]').exists()).toBe(false)
    })

    it('offers a void receipt as void, and no new receipt for a reversed payment', () => {
      const withoutReceipt = makePayment({ id: 'c', status: 'reversed', reversal, receipt: null })
      const wrapper = mount(PaymentHistory, {
        props: { payments: [reversed, withoutReceipt], receipts: true },
      })

      expect(wrapper.findAll('[data-testid="download-receipt"]').map((b) => b.text())).toEqual([
        'Download void receipt',
      ])
    })

    it('offers Reverse only to owners, only on payments that still count', async () => {
      const recorded = makePayment({ id: 'b' })
      const wrapper = mount(PaymentHistory, {
        props: { payments: [recorded, reversed], receipts: true, canReverse: true },
      })
      const buttons = wrapper.findAll('[data-testid="reverse-payment"]')

      expect(buttons).toHaveLength(1)
      expect(buttons[0]!.attributes('aria-label')).toBe('Reverse the ₹10,000 payment of 3 Oct 2026')
      await buttons[0]!.trigger('click')
      expect(wrapper.emitted('reverse-payment')).toEqual([['b']])

      const managerView = mount(PaymentHistory, { props: { payments: [recorded], receipts: true } })
      expect(managerView.find('[data-testid="reverse-payment"]').exists()).toBe(false)
    })

    it('shows reasons as text, never HTML', () => {
      const wrapper = mount(PaymentHistory, {
        props: {
          payments: [
            makePayment({ status: 'reversed', reversal: { ...reversal, reason: '<b>x</b>' } }),
          ],
        },
      })

      expect(wrapper.find('b').exists()).toBe(false)
      expect(wrapper.text()).toContain('<b>x</b>')
    })
  })
})
