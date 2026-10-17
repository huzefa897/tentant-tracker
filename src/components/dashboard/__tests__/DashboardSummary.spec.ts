import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DashboardSummary from '@/components/dashboard/DashboardSummary.vue'
import { makeSummary } from '@/test/mocks/dashboardService'

function render(overrides = {}) {
  return mount(DashboardSummary, { props: { summary: makeSummary(overrides) } })
}

const text = (wrapper: ReturnType<typeof render>, id: string) =>
  wrapper.get(`[data-testid="summary-${id}"] dd`).text().replace(/\s+/g, ' ')

describe('DashboardSummary', () => {
  it('counts overdue months, with the oldest and what’s left to pay on them', () => {
    // The fake's overdue bill is ₹15,750 with ₹10,000 paid: the summary gives what's left.
    const wrapper = render()

    expect(text(wrapper, 'overdue')).toBe('2 months overdue Oldest 25 days · ₹5,750 outstanding')
    expect(
      text(render({ overduePeriodCount: 1, oldestOverdueDays: 1, knownOverdue: 0 }), 'overdue'),
    ).toBe('1 month overdue Oldest 1 day')
  })

  it('says when nothing is overdue, without colour', () => {
    const wrapper = render({ overduePeriodCount: 0, oldestOverdueDays: null, knownOverdue: 0 })

    expect(text(wrapper, 'overdue')).toBe('Nothing overdue')
    expect(wrapper.get('[data-testid="summary-overdue"]').classes()).not.toContain(
      'bg-destructive/5',
    )
    expect(render().get('[data-testid="summary-overdue"]').classes()).toContain('bg-destructive/5')
  })

  it('counts bills not prepared and offers to show them', async () => {
    const wrapper = render()

    expect(text(wrapper, 'unbilled')).toBe('2 bills not prepared 1 of them overdue')
    await wrapper.get('[data-testid="show-unbilled"]').trigger('click')
    expect(wrapper.emitted('showUnbilled')).toHaveLength(1)

    const allPrepared = render({ awaitingBillPeriodCount: 0, overdueAwaitingBillPeriodCount: 0 })
    expect(text(allPrepared, 'unbilled')).toBe('Every bill prepared')
    expect(allPrepared.find('[data-testid="show-unbilled"]').exists()).toBe(false)
  })

  it('shows the amount from prepared bills, naming the months left out', () => {
    expect(text(render(), 'total')).toBe(
      '₹5,750 outstanding 2 tenants · not counting 2 months awaiting a bill',
    )
    expect(
      text(render({ awaitingBillPeriodCount: 0, overdueAwaitingBillPeriodCount: 0 }), 'total'),
    ).toBe('₹5,750 outstanding 2 tenants · from prepared bills')
  })

  it('never shows ₹0 when no bill is prepared', () => {
    const wrapper = render({ knownOutstanding: 0, knownOverdue: 0 })

    expect(text(wrapper, 'total')).toBe('No amount yet 2 months awaiting a bill')
    expect(wrapper.text()).not.toContain('₹0')
  })

  it('says when nothing is owed', () => {
    const wrapper = render({
      owedPeriodCount: 0,
      overduePeriodCount: 0,
      oldestOverdueDays: null,
      upcomingPeriodCount: 0,
      awaitingBillPeriodCount: 0,
      overdueAwaitingBillPeriodCount: 0,
      owingTenancyCount: 0,
      knownOutstanding: 0,
      knownOverdue: 0,
    })

    expect(text(wrapper, 'total')).toBe('Nothing owed')
  })

  it('is a list of terms and values under a heading', () => {
    const wrapper = render()

    expect(wrapper.get('h2').text()).toBe('Summary')
    expect(wrapper.findAll('dt').map((term) => term.text())).toEqual([
      'Overdue',
      'Bills',
      'Outstanding',
    ])
  })
})
