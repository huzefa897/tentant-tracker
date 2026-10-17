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
    expect(wrapper.get('[data-testid="summary-owing-tenants"]').text()).toBe('2 tenants owing')
    expect(wrapper.get('[data-testid="summary-excluded"]').text()).toBe(
      'From prepared bills only. 2 months awaiting a bill (1 overdue) aren’t included: their amounts aren’t calculated yet.',
    )
    expect(
      render({ awaitingBillPeriodCount: 1, overdueAwaitingBillPeriodCount: 0 })
        .get('[data-testid="summary-excluded"]')
        .text(),
    ).toBe(
      'From prepared bills only. 1 month awaiting a bill isn’t included: its amount isn’t calculated yet.',
    )
    expect(
      render({ awaitingBillPeriodCount: 0 }).get('[data-testid="summary-excluded"]').text(),
    ).toBe('From prepared bills. Every month that’s owed has its bill.')
  })

  it('counts rental months by when they’re due, each with its amount from bills', () => {
    const wrapper = render({ dueTodayPeriodCount: 1, knownDueToday: 18500 })

    expect(wrapper.get('[data-testid="summary-overdue"]').text()).toBe(
      'Overdue2 months2 tenants · ₹5,750 from bills',
    )
    expect(wrapper.get('[data-testid="summary-due-today"]').text()).toBe(
      'Due today1 month₹18,500 from bills',
    )
    expect(wrapper.get('[data-testid="summary-upcoming"]').text()).toBe(
      'Due in the next 7 days1 month₹0 from bills',
    )
  })

  it('says so when nothing is due, and when nobody owes', () => {
    const wrapper = render({
      overduePeriodCount: 0,
      overdueTenancyCount: 0,
      upcomingPeriodCount: 0,
      owingTenancyCount: 0,
    })

    expect(wrapper.get('[data-testid="summary-overdue"]').text()).toBe(
      'Overdue0 monthsNothing late',
    )
    expect(wrapper.get('[data-testid="summary-due-today"]').text()).toContain('Nothing due today')
    expect(wrapper.get('[data-testid="summary-upcoming"]').text()).toContain(
      'Nothing due this week',
    )
    expect(wrapper.get('[data-testid="summary-owing-tenants"]').text()).toBe('Nobody owes rent')
  })

  it('colours only late money', () => {
    const late = render({ dueTodayPeriodCount: 1, knownDueToday: 750 })
    const onTime = render({ overduePeriodCount: 0, overdueTenancyCount: 0 })
    const value = (wrapper: ReturnType<typeof render>, id: string) =>
      wrapper.get(`[data-testid="summary-${id}"] [data-testid="summary-value"]`).classes()

    expect(value(late, 'overdue')).toContain('text-destructive')
    expect(value(late, 'due-today')).toContain('text-warning')
    expect(value(late, 'upcoming')).not.toContain('text-destructive')
    expect(value(onTime, 'overdue')).not.toContain('text-destructive')
  })

  it('is a list of terms and values under a heading, with its icons hidden', () => {
    const wrapper = render()

    expect(wrapper.get('h2').text()).toBe('Summary')
    expect(wrapper.findAll('dt')).toHaveLength(4)
    for (const icon of wrapper.findAll('dt > span')) {
      expect(icon.attributes('aria-hidden')).toBe('true')
    }
  })
})
