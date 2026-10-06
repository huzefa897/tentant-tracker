import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentEntryHistory from '@/components/rent/RentEntryHistory.vue'
import { makeEntry } from '@/test/rentEntries'

const entries = [
  makeEntry({ id: 'a', billingMonth: '2026-10', totalPaid: 10000 }),
  makeEntry({ id: 'b', billingMonth: '2026-09', totalPaid: 15750 }),
  makeEntry({ id: 'c', billingMonth: '2026-08', electricityUnits: 1.125 }),
]

describe('RentEntryHistory', () => {
  it('shows each bill’s month, figures and status in a table row, in the given order', () => {
    const wrapper = mount(RentEntryHistory, { props: { entries } })

    const rows = wrapper
      .findAll('[data-testid="history-row"]')
      .map((row) => row.findAll('th, td').map((cell) => cell.text()))

    expect(rows).toEqual([
      ['October 2026', '₹15,750', '₹10,000', '₹5,750', 'Partially paid', 'View Summary'],
      ['September 2026', '₹15,750', '₹15,750', '₹0', 'Paid', 'View Summary'],
      ['August 2026', '₹15,306.75', '₹0', '₹15,306.75', 'Unpaid', 'View Summary'],
    ])
  })

  it('shows the bill’s own figures rather than recalculating them', () => {
    const wrapper = mount(RentEntryHistory, {
      props: { entries: [makeEntry({ totalDue: 99, outstanding: 99 })] },
    })

    expect(wrapper.get('[data-testid="history-row"]').text()).toContain('₹99')
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
    const summaries = wrapper.findAll('[aria-label="View summary for September 2026"]')

    await summaries[0]!.trigger('click')
    await summaries[1]!.trigger('click')

    expect(wrapper.emitted('view')).toEqual([['b'], ['b']])
  })
})
