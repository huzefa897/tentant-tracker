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
  it('shows the bill’s month, charges and amounts', () => {
    const wrapper = mount(LatestEntryCard, {
      props: { entry: makeEntry(), totalPaid: 10000, lastPaidDate: '2026-10-03' },
    })

    expect(wrapper.get('h3').text()).toBe('September 2026')
    expect(wrapper.text()).toContain('Partially paid')
    expect(rows(wrapper, 'latest-entry-charges')).toEqual([
      ['Rent', '₹15,000'],
      ['Electricity (75 units × ₹6)', '₹450'],
      ['Water', '₹300'],
    ])
    expect(rows(wrapper, 'latest-entry-amounts')).toEqual([
      ['Total due', '₹15,750'],
      ['Total paid (last 3 Oct 2026)', '₹10,000'],
      ['Outstanding', '₹5,750'],
    ])
  })

  it('leaves out the last paid date when nothing has been paid', () => {
    const wrapper = mount(LatestEntryCard, {
      props: { entry: makeEntry(), totalPaid: 0, lastPaidDate: null },
    })

    expect(wrapper.text()).toContain('Unpaid')
    expect(rows(wrapper, 'latest-entry-amounts')[1]).toEqual(['Total paid', '₹0'])
  })

  it('emits view with the entry id', async () => {
    const wrapper = mount(LatestEntryCard, {
      props: { entry: makeEntry(), totalPaid: 0, lastPaidDate: null },
    })

    await wrapper.get('button[aria-label="View summary for September 2026"]').trigger('click')

    expect(wrapper.emitted('view')).toEqual([['entry-1']])
  })
})
