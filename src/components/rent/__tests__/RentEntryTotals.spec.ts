import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentEntryTotals from '@/components/rent/RentEntryTotals.vue'

describe('RentEntryTotals', () => {
  it('labels the totals as covering the displayed entries', () => {
    const wrapper = mount(RentEntryTotals, {
      props: { totals: { totalBilled: 47250, totalPaid: 25750, outstanding: 21500 } },
    })

    expect(wrapper.get('h2').text()).toBe('Totals for displayed entries')
    const values = Object.fromEntries(
      wrapper.findAll('dl > div').map((tile) => [tile.get('dt').text(), tile.get('dd').text()]),
    )
    expect(values).toEqual({
      'Total billed': '₹47,250',
      'Total paid': '₹25,750',
      Outstanding: '₹21,500',
    })
  })
})
