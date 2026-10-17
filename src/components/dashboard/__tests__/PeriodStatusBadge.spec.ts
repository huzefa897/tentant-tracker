import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PeriodStatusBadge from '@/components/dashboard/PeriodStatusBadge.vue'
import { makePeriod } from '@/test/mocks/dashboardService'
import type { RentalPeriodRow } from '@/types/dashboard'

function render(overrides: Partial<RentalPeriodRow>) {
  return mount(PeriodStatusBadge, {
    props: { period: makePeriod(overrides), asOfDate: '2026-10-15' },
  })
}

describe('PeriodStatusBadge', () => {
  it('says when the month is due in words, colouring only late ones', () => {
    const overdue = render({ timing: 'overdue', daysOverdue: 4 })
    const today = render({ timing: 'due_today', daysOverdue: 0, dueDate: '2026-10-15' })
    const soon = render({ timing: 'upcoming', daysOverdue: 0, dueDate: '2026-10-18' })

    expect(overdue.text()).toBe('Overdue 4 days')
    expect(overdue.classes()).toContain('text-destructive')
    expect(today.text()).toBe('Due today')
    expect(today.classes()).toContain('text-warning')
    expect(soon.text()).toBe('Due in 3 days')
    expect(soon.classes()).toContain('text-muted-foreground')
  })

  it('hides its dot from screen readers', () => {
    expect(render({}).get('span > span').attributes('aria-hidden')).toBe('true')
  })
})
