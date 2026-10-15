import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DashboardSummary from '@/components/dashboard/DashboardSummary.vue'
import { makeSummary } from '@/test/mocks/dashboardService'

function render(overrides = {}) {
  return mount(DashboardSummary, { props: { summary: makeSummary(overrides) } })
}

describe('DashboardSummary', () => {
  it('shows outstanding, then the late and due-soon parts of it', () => {
    const wrapper = render()

    expect(wrapper.get('[data-testid="summary-outstanding"]').text()).toBe('₹39,500')
    expect(wrapper.get('[data-testid="summary-owed-by"]').text()).toBe(
      'Owed by 2 tenants, on recorded bills.',
    )
    expect(wrapper.text()).toContain('Of which')
    expect(wrapper.get('[data-testid="summary-overdue"]').text()).toBe('Overdue₹5,7501 tenant')
    expect(wrapper.get('[data-testid="summary-due-today"]').text()).toBe('Due today₹0')
    expect(wrapper.get('[data-testid="summary-due-soon"]').text()).toBe(
      'Due in the next 7 days₹18,000',
    )
  })

  it('colours only late money', () => {
    const late = render({ dueToday: 750 })
    const onTime = render({ overdue: 0, overdueTenancyCount: 0 })

    expect(late.get('[data-testid="summary-overdue"] dd span').classes()).toContain(
      'text-destructive',
    )
    expect(late.get('[data-testid="summary-due-today"] dd span').classes()).toContain(
      'text-warning',
    )
    expect(late.get('[data-testid="summary-due-soon"] dd span').classes()).not.toContain(
      'text-warning',
    )
    expect(onTime.get('[data-testid="summary-overdue"]').text()).toBe('Overdue₹0Nothing late')
    expect(onTime.get('[data-testid="summary-overdue"] dd span').classes()).not.toContain(
      'text-destructive',
    )
  })

  it('says when nothing is owed', () => {
    const wrapper = render({ outstanding: 0, overdue: 0, dueNext7Days: 0, pendingTenancyCount: 0 })

    expect(wrapper.get('[data-testid="summary-owed-by"]').text()).toBe(
      'Nothing is owed on recorded bills.',
    )
  })

  it('says how much is on bills without a due date, only when there is some', () => {
    expect(render().find('[data-testid="summary-without-due-date"]').exists()).toBe(false)

    const wrapper = render({ withoutDueDate: 15000 })

    expect(wrapper.get('[data-testid="summary-without-due-date"]').text()).toContain(
      '₹15,000 of it is on bills without a due date',
    )
  })
})
