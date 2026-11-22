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

  it('shows a meter bill’s readings, and "Not charged" for electricity left off', () => {
    const meter = mount(LatestEntryCard, {
      props: {
        entry: makeEntry({
          electricityMode: 'meter',
          electricityUnits: 422,
          electricityRate: 8,
          openingReading: { id: null, reading: 2563, readOn: '2026-10-31' },
          closingReading: { id: 'r2', reading: 2985, readOn: '2026-12-31' },
        }),
      },
    })
    expect(rows(meter, 'latest-entry-charges')[1]).toEqual([
      'Electricity (2,563 → 2,985: 422 units × ₹8)',
      '₹3,376',
    ])

    const off = mount(LatestEntryCard, {
      props: { entry: makeEntry({ electricityMode: 'not_charged', electricityUnits: 0 }) },
    })
    expect(rows(off, 'latest-entry-charges')[1]).toEqual(['Electricity', 'Not charged'])
  })

  it('emits view with the entry id', async () => {
    const wrapper = mount(LatestEntryCard, { props: { entry: makeEntry() } })

    await wrapper.get('button[aria-label="View bill for September 2026"]').trigger('click')

    expect(wrapper.emitted('view')).toEqual([['entry-1']])
  })

  it('offers the receipt once anything is paid, emitting the entry id', async () => {
    const wrapper = mount(LatestEntryCard, { props: { entry: makeEntry({ totalPaid: 10000 }) } })
    const button = wrapper.get('[data-testid="download-entry-receipt"]')

    expect(button.text()).toBe('Download receipt')
    expect(button.attributes('aria-label')).toBe('Download the latest receipt for September 2026')
    await button.trigger('click')

    expect(wrapper.emitted('download-receipt')).toEqual([['entry-1']])
  })

  it('offers no receipt for an unpaid bill', () => {
    const wrapper = mount(LatestEntryCard, { props: { entry: makeEntry() } })

    expect(wrapper.find('[data-testid="download-entry-receipt"]').exists()).toBe(false)
  })

  it('shows Preparing… and waits while the receipt is prepared', () => {
    const wrapper = mount(LatestEntryCard, {
      props: { entry: makeEntry({ totalPaid: 10000 }), downloadingReceipt: true },
    })
    const button = wrapper.get('[data-testid="download-entry-receipt"]')

    expect(button.text()).toBe('Preparing…')
    expect(button.attributes('disabled')).toBeDefined()
  })
})
