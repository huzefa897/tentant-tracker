import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import OverdueTenantList from '@/components/dashboard/OverdueTenantList.vue'
import { makeOverdueBill, makeOverdueTenant } from '@/test/mocks/dashboardService'
import { isShown, mountAt, overflowing, unmountAll } from '@/test/layout'

// The largest bill a tenant can have (a 12-digit amount), in every amount column at once.
const tenant = makeOverdueTenant({
  bills: [
    makeOverdueBill({
      billingMonth: '2026-09',
      totalAmount: 9999999999.99,
      paidAmount: 8888888888.88,
      outstanding: 1111111111.11,
    }),
  ],
})

// Each tenant is a card with a 1px border, so a card `inside` px wide inside takes 2px more.
const card = (inside: number) => inside + 2

function mountList(viewport: number, width?: number) {
  return mountAt({ viewport, width }, (attachTo) =>
    mount(OverdueTenantList, { props: { tenants: [tenant], showProperty: true }, attachTo }),
  )
}

afterEach(unmountAll)

describe('OverdueTenantList layout', () => {
  it('fits the largest amounts in the table at its minimum width', async () => {
    const list = await mountList(1280, card(960))
    const wrapper = list.get('[data-testid="overdue-bill-table"]').element

    expect(isShown(wrapper)).toBe(true)
    expect(overflowing(list.get('table').element.querySelectorAll('th, td'))).toEqual([])
    expect(wrapper.scrollWidth).toBe(wrapper.clientWidth)
  })

  it('scrolls the table in a narrower card rather than overlapping the amounts', async () => {
    const list = await mountList(1280, card(800))
    const wrapper = list.get('[data-testid="overdue-bill-table"]').element

    expect(wrapper.scrollWidth).toBeGreaterThan(wrapper.clientWidth)
    expect(overflowing(list.get('table').element.querySelectorAll('th, td'))).toEqual([])
  })

  it.each([
    ['a small laptop', 1100],
    ['a tablet', 768],
    ['a phone', 360],
  ])('shows rows, not the table, on %s, with every amount in view', async (_, viewport) => {
    const list = await mountList(viewport)
    const items = list.get('[data-testid="overdue-bill-items"]').element

    expect(isShown(list.get('[data-testid="overdue-bill-table"]').element)).toBe(false)
    expect(isShown(items)).toBe(true)
    expect(overflowing(items.querySelectorAll('button, span'))).toEqual([])
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(viewport)
  })
})
