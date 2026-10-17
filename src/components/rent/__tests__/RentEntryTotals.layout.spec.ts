import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import RentEntryTotals from '@/components/rent/RentEntryTotals.vue'
import { mountAt, overflowing, unmountAll } from '@/test/layout'

// A page of large bills: totals past a crore.
const totals = { totalBilled: 123456789.5, totalPaid: 98765432.25, outstanding: 24691357.25 }

afterEach(unmountAll)

describe('RentEntryTotals layout', () => {
  it.each([
    ['a small phone', 320],
    ['a phone', 360],
    ['the widest phone layout', 639],
    ['a tablet, three side by side', 640],
  ])('fits every total in its own box on %s', async (_, viewport) => {
    const wrapper = await mountAt({ viewport }, (attachTo) =>
      mount(RentEntryTotals, { props: { totals }, attachTo }),
    )
    const figures = wrapper.findAll('dl > div').map((figure) => figure.element)

    expect(overflowing(figures)).toEqual([])
    expect(overflowing(wrapper.findAll('dd').map((dd) => dd.element))).toEqual([])
    // Each amount stays on one line, inside its figure.
    for (const figure of figures) {
      const box = figure.getBoundingClientRect()
      const amount = figure.querySelector('dd')!.getBoundingClientRect()
      expect(amount.right).toBeLessThanOrEqual(box.right)
      expect(amount.height).toBeLessThan(40)
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(viewport)
  })
})
