import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LatestEntryCard from '@/components/rent/LatestEntryCard.vue'
import { makeEntry } from '@/test/rentEntries'

function rows(wrapper: ReturnType<typeof mount>, testId: string) {
  return wrapper
    .get(`[data-testid="${testId}"]`)
    .findAll('div')
    .map((row) => [row.get('dt').text(), row.get('dd').text()])
}

describe('LatestEntryCard', () => {
  it('shows the bill’s month, charges and figures', () => {
    const wrapper = mount(LatestEntryCard, { props: { entry: makeEntry({ totalPaid: 10000 }) } })

    expect(wrapper.get('h3').text()).toBe('September 2026')
    expect(wrapper.text()).toContain('Partially paid')
    expect(rows(wrapper, 'latest-entry-charges')).toEqual([
      ['Rent', '₹15,000'],
      ['Electricity (75 units × ₹6)', '₹450'],
      ['Water', '₹300'],
    ])
    expect(rows(wrapper, 'latest-entry-amounts')).toEqual([
      ['Total due', '₹15,750'],
      ['Total paid', '₹10,000'],
      ['Outstanding', '₹5,750'],
    ])
  })

  it('shows the backend’s figures rather than recalculating them', () => {
    const wrapper = mount(LatestEntryCard, {
      props: { entry: makeEntry({ electricityAmount: 451, totalDue: 15751, outstanding: 15751 }) },
    })

    expect(rows(wrapper, 'latest-entry-charges')[1]![1]).toBe('₹451')
    expect(rows(wrapper, 'latest-entry-amounts')[0]).toEqual(['Total due', '₹15,751'])
    expect(wrapper.text()).toContain('Unpaid')
  })

  it('emits view with the entry id', async () => {
    const wrapper = mount(LatestEntryCard, { props: { entry: makeEntry() } })

    await wrapper.get('button[aria-label="View summary for September 2026"]').trigger('click')

    expect(wrapper.emitted('view')).toEqual([['entry-1']])
  })
})
