import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DashboardSummary from '@/components/dashboard/DashboardSummary.vue'
import { makeSummary } from '@/test/mocks/dashboardService'

function render(overrides = {}) {
  return mount(DashboardSummary, { props: { summary: makeSummary(overrides) } })
}

describe('DashboardSummary', () => {
  it('shows the known amount, and that months awaiting a bill aren’t in it', () => {
    const wrapper = render()

    expect(wrapper.get('[data-testid="summary-known-outstanding"]').text()).toBe('₹5,750')
    expect(wrapper.get('[data-testid="summary-excluded"]').text()).toBe(
      'From prepared bills only. 2 months awaiting a bill aren’t included: their amounts aren’t calculated yet.',
    )
    expect(
      render({ awaitingBillPeriodCount: 1 }).get('[data-testid="summary-excluded"]').text(),
    ).toBe(
      'From prepared bills only. 1 month awaiting a bill isn’t included: its amount isn’t calculated yet.',
    )
    expect(
      render({ awaitingBillPeriodCount: 0 }).get('[data-testid="summary-excluded"]').text(),
    ).toBe('From prepared bills. Every month that’s owed has its bill.')
  })

  it('counts rental months, and names tenants only where it counts them', () => {
    const wrapper = render()

    expect(wrapper.get('[data-testid="summary-owing-tenants"]').text()).toBe('· 2 tenants')
    expect(wrapper.get('[data-testid="summary-overdue"]').text()).toBe(
      'Overdue2 months2 tenants · ₹5,750 known',
    )
    expect(wrapper.get('[data-testid="summary-due-today"]').text()).toBe('Due today0 months')
    expect(wrapper.get('[data-testid="summary-awaiting-bill"]').text()).toBe(
      'Awaiting a bill2 months1 of them overdue',
    )
    expect(wrapper.get('[data-testid="summary-upcoming"]').text()).toBe(
      'Due in the next 7 days1 month',
    )
  })

  it('colours only late money', () => {
    const late = render({ dueTodayPeriodCount: 1, knownDueToday: 750 })
    const onTime = render({ overduePeriodCount: 0, overdueTenancyCount: 0 })

    expect(late.get('[data-testid="summary-overdue"] dd span').classes()).toContain(
      'text-destructive',
    )
    expect(late.get('[data-testid="summary-due-today"] dd span').classes()).toContain(
      'text-warning',
    )
    expect(late.get('[data-testid="summary-awaiting-bill"] dd span').classes()).not.toContain(
      'text-destructive',
    )
    expect(onTime.get('[data-testid="summary-overdue"]').text()).toBe('Overdue0 monthsNothing late')
    expect(onTime.get('[data-testid="summary-overdue"] dd span').classes()).not.toContain(
      'text-destructive',
    )
  })
})
