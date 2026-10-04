import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentEntryHistory from '@/components/rent/RentEntryHistory.vue'
import type { RentEntry } from '@/types/rentEntry'
import type { BilledEntry } from '@/utils/rentCalculations'

// Each bill with the sum of its payments, as the page passes it.
function bill(id: string, billingMonth: string, totalPaid: number): BilledEntry<RentEntry> {
  const entry: RentEntry = {
    id,
    tenantId: 'tenant-001',
    billingMonth,
    rentAmount: 15000,
    electricityUnits: 75,
    electricityRate: 6,
    waterAmount: 300,
    notes: '',
    createdAt: '2026-10-03T06:00:00.000Z',
  }
  return { entry, totalPaid }
}

const bills = [bill('a', '2026-10', 10000), bill('b', '2026-09', 15750), bill('c', '2026-08', 0)]

describe('RentEntryHistory', () => {
  it('shows each entry’s month, amounts and status in a table row, in the given order', () => {
    const wrapper = mount(RentEntryHistory, { props: { bills } })

    const rows = wrapper
      .findAll('[data-testid="history-row"]')
      .map((row) => row.findAll('th, td').map((cell) => cell.text()))

    expect(rows).toEqual([
      [
        'October 2026',
        '₹15,750',
        '₹10,000',
        '₹5,750',
        'Partially paid',
        'View Summary  Print Receipt',
      ],
      ['September 2026', '₹15,750', '₹15,750', '₹0', 'Paid', 'View Summary  Print Receipt'],
      // Nothing paid, so nothing to receipt.
      ['August 2026', '₹15,750', '₹0', '₹15,750', 'Unpaid', 'View Summary'],
    ])
  })

  it('shows the same figures on mobile cards', () => {
    const wrapper = mount(RentEntryHistory, { props: { bills } })
    const card = wrapper.findAll('[data-testid="history-card"]')[0]!

    expect(card.get('h3').text()).toBe('October 2026')
    expect(card.text()).toContain('Partially paid')
    expect(card.text()).toContain('Total due₹15,750')
    expect(card.text()).toContain('Total paid₹10,000')
    expect(card.text()).toContain('Outstanding₹5,750')
  })

  it('emits view with the entry id from the table and the cards', async () => {
    const wrapper = mount(RentEntryHistory, { props: { bills } })
    const summaries = wrapper.findAll('[aria-label="View summary for September 2026"]')

    await summaries[0]!.trigger('click')
    await summaries[1]!.trigger('click')

    expect(wrapper.emitted('view')).toEqual([['b'], ['b']])
  })

  it('emits view-receipt from the table and the cards, only for bills with a payment', async () => {
    const wrapper = mount(RentEntryHistory, { props: { bills } })
    const receipts = wrapper.findAll('[aria-label="View or print receipt for October 2026"]')

    expect(receipts).toHaveLength(2)
    await receipts[0]!.trigger('click')
    await receipts[1]!.trigger('click')

    expect(wrapper.emitted('view-receipt')).toEqual([['a'], ['a']])
    expect(wrapper.find('[aria-label="View or print receipt for August 2026"]').exists()).toBe(
      false,
    )
  })
})
