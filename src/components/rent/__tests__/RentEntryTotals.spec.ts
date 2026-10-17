import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentEntryTotals from '@/components/rent/RentEntryTotals.vue'

describe('RentEntryTotals', () => {
  it('labels the totals as covering this page only', () => {
    const wrapper = mount(RentEntryTotals, {
      props: { totals: { totalBilled: 47250, totalPaid: 25750, outstanding: 21500 } },
    })

    expect(wrapper.get('h2').text()).toBe('Totals for this page')
    const values = Object.fromEntries(
      wrapper.findAll('dl > div').map((tile) => [tile.get('dt').text(), tile.get('dd').text()]),
    )
    expect(values).toEqual({
      'Total billed': '₹47,250',
      'Total paid': '₹25,750',
      Outstanding: '₹21,500',
    })
  })

  it('stacks on phones, so a large page total has the width it needs', () => {
    const wrapper = mount(RentEntryTotals, {
      props: { totals: { totalBilled: 123456789.5, totalPaid: 0, outstanding: 123456789.5 } },
    })
    const strip = wrapper.get('[data-testid="entry-totals"]')

    // Three columns only from sm up; one row per figure below that.
    expect(strip.classes()).toEqual(expect.arrayContaining(['grid', 'sm:grid-cols-3']))
    expect(strip.classes()).not.toContain('grid-cols-3')
    expect(wrapper.findAll('dd').map((dd) => dd.text())).toEqual([
      '₹12,34,56,789.50',
      '₹0',
      '₹12,34,56,789.50',
    ])
    // Never spills into the next figure, even past the widths above.
    for (const dd of wrapper.findAll('dd')) expect(dd.classes()).toContain('break-all')
  })

  it('says void bills on the page aren’t counted, only when there are some', () => {
    const totals = { totalBilled: 15750, totalPaid: 0, outstanding: 15750 }

    expect(mount(RentEntryTotals, { props: { totals } }).text()).not.toContain('void')
    expect(
      mount(RentEntryTotals, { props: { totals, voidCount: 1 } })
        .get('[data-testid="void-not-counted"]')
        .text(),
    ).toBe("The void bill on this page isn't counted.")
    expect(
      mount(RentEntryTotals, { props: { totals, voidCount: 2 } })
        .get('[data-testid="void-not-counted"]')
        .text(),
    ).toBe("The 2 void bills on this page aren't counted.")
  })
})
