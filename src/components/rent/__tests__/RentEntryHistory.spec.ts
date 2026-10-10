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
      [
        'October 2026',
        '₹15,750',
        '₹10,000',
        '₹5,750',
        'Partially paid',
        'Download receipt View Summary',
      ],
      ['September 2026', '₹15,750', '₹15,750', '₹0', 'Paid', 'Download receipt View Summary'],
      ['August 2026', '₹15,306.75', '₹0', '₹15,306.75', 'Unpaid', 'View Summary'],
    ])
  })

  it('marks a void bill VOID, muted with its figures struck through, never as paid', () => {
    const wrapper = mount(RentEntryHistory, {
      props: {
        entries: [makeEntry({ id: 'v', billingMonth: '2026-10', billStatus: 'void' })],
      },
    })
    const row = wrapper.get('[data-testid="history-row"]')

    expect(row.findAll('th, td').map((cell) => cell.text())).toEqual([
      'October 2026',
      '₹15,750',
      '₹0',
      '₹0',
      'Void',
      'View Summary',
    ])
    expect(row.classes()).toContain('text-muted-foreground')
    expect(row.findAll('td.line-through')).toHaveLength(3)
    const card = wrapper.get('[data-testid="history-card"]')
    expect(card.get('[data-testid="void-badge"]').text()).toBe('Void')
    expect(card.get('dl').classes()).toContain('line-through')
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

  it('offers a paid bill’s receipt from the table and the cards, never an unpaid one’s', async () => {
    const wrapper = mount(RentEntryHistory, { props: { entries } })
    const buttons = wrapper.findAll('[aria-label="Download the latest receipt for September 2026"]')

    expect(buttons).toHaveLength(2)
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')

    expect(wrapper.emitted('download-receipt')).toEqual([['b'], ['b']])
    expect(
      wrapper.find('[aria-label="Download the latest receipt for August 2026"]').exists(),
    ).toBe(false)
  })

  it('shows which receipt is being prepared and makes every receipt button wait', () => {
    const wrapper = mount(RentEntryHistory, { props: { entries, downloadingEntryId: 'b' } })
    const buttons = wrapper.findAll('[data-testid="download-entry-receipt"]')

    expect(buttons.map((b) => b.text())).toEqual([
      'Download receipt',
      'Preparing…',
      'Download receipt',
      'Preparing…',
    ])
    expect(buttons.every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })
})
