import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentEntryHistory from '@/components/rent/RentEntryHistory.vue'
import type { RentEntry } from '@/types/rentEntry'

function entry(id: string, billingMonth: string, totalPaid: number): RentEntry {
  return {
    id,
    tenantId: 'tenant-001',
    billingMonth,
    rentAmount: 15000,
    electricityUnits: 75,
    electricityRate: 6,
    waterAmount: 300,
    totalPaid,
    paidDate: totalPaid > 0 ? '2026-10-01' : null,
    notes: '',
    createdAt: '2026-10-03T06:00:00.000Z',
  }
}

const entries = [
  entry('a', '2026-10', 10000),
  entry('b', '2026-09', 15750),
  entry('c', '2026-08', 0),
]

describe('RentEntryHistory', () => {
  it('shows each entry’s month, amounts and status in a table row, in the given order', () => {
    const wrapper = mount(RentEntryHistory, { props: { entries } })

    const rows = wrapper
      .findAll('[data-testid="history-row"]')
      .map((row) => row.findAll('th, td').map((cell) => cell.text()))

    expect(rows).toEqual([
      ['October 2026', '₹15,750', '₹10,000', '₹5,750', 'Partially paid', 'View'],
      ['September 2026', '₹15,750', '₹15,750', '₹0', 'Paid', 'View'],
      ['August 2026', '₹15,750', '₹0', '₹15,750', 'Unpaid', 'View'],
    ])
  })

  it('shows the same figures on mobile cards', () => {
    const wrapper = mount(RentEntryHistory, { props: { entries } })
    const card = wrapper.findAll('[data-testid="history-card"]')[0]!

    expect(card.get('h3').text()).toBe('October 2026')
    expect(card.text()).toContain('Partially paid')
    expect(card.text()).toContain('Total due₹15,750')
    expect(card.text()).toContain('Total paid₹10,000')
    expect(card.text()).toContain('Outstanding₹5,750')
  })

  it('emits view with the entry id from the table and the cards', async () => {
    const wrapper = mount(RentEntryHistory, { props: { entries } })

    await wrapper.get('[aria-label="View September 2026"]').trigger('click')
    await wrapper.get('[aria-label="View details for August 2026"]').trigger('click')

    expect(wrapper.emitted('view')).toEqual([['b'], ['c']])
  })
})
