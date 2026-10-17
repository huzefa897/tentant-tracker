import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PeriodFilterBar from '@/components/dashboard/PeriodFilterBar.vue'
import type { PreparationFilter, TimingFilter } from '@/types/dashboard'

function render(
  props: {
    timing?: TimingFilter
    preparation?: PreparationFilter
    month?: string | null
    counts?: Partial<Record<TimingFilter, number>>
  } = {},
) {
  return mount(PeriodFilterBar, {
    props: {
      timing: props.timing ?? 'due',
      preparation: props.preparation ?? 'all',
      month: props.month ?? null,
      months: ['2026-10', '2026-09'],
      counts: props.counts,
    },
    slots: { heading: '<h2>Rental months</h2>' },
  })
}

describe('PeriodFilterBar', () => {
  it('presses the chosen timing and emits another', async () => {
    const wrapper = render()

    expect(
      wrapper.findAll('[role="group"] button').map((b) => [b.text(), b.attributes('aria-pressed')]),
    ).toEqual([
      ['Due now', 'true'],
      ['Overdue', 'false'],
      ['Due today', 'false'],
      ['Next 7 days', 'false'],
      ['All owed', 'false'],
    ])

    await wrapper.get('[data-testid="timing-filter-upcoming"]').trigger('click')

    expect(wrapper.emitted('update:timing')).toEqual([['upcoming']])
  })

  it('shows how many months each timing has, read out as months', () => {
    const wrapper = render({ counts: { due: 3, overdue: 2, due_today: 1, upcoming: 0 } })
    const due = wrapper.get('[data-testid="timing-filter-due"]')

    expect(wrapper.findAll('[data-testid="timing-count"]').map((c) => c.text())).toEqual([
      '3',
      '2',
      '1',
      '0',
    ])
    expect(due.get('[data-testid="timing-count"]').attributes('aria-hidden')).toBe('true')
    expect(due.get('.sr-only').text()).toBe('(3 months)')
    expect(wrapper.get('[data-testid="timing-filter-all"]').text()).toBe('All owed')
  })

  it('puts the list’s heading beside its filters', () => {
    expect(render().get('h2').text()).toBe('Rental months')
  })

  it('chooses whether the bill is prepared, and a month or every month', async () => {
    const wrapper = render({ month: '2026-09' })

    expect(wrapper.findAll('[data-testid="filter-summary"]').map((s) => s.text())).toEqual([
      'Bill: All',
      'Month: September 2026',
    ])
    expect(wrapper.findAll('[data-testid="filter-month"] option').map((o) => o.text())).toEqual([
      'All months',
      'October 2026',
      'September 2026',
    ])

    await wrapper.get('[data-testid="filter-preparation"]').setValue('not_prepared')
    await wrapper.get('[data-testid="filter-month"]').setValue('all')

    expect(wrapper.emitted('update:preparation')).toEqual([['not_prepared']])
    expect(wrapper.emitted('update:month')).toEqual([[null]])
  })

  it('offers Clear filters only when the list is narrowed', async () => {
    expect(render().text()).not.toContain('Clear filters')

    const wrapper = render({ preparation: 'prepared' })
    const clear = wrapper.findAll('button').find((b) => b.text() === 'Clear filters')
    await clear!.trigger('click')

    expect(wrapper.emitted('clear')).toHaveLength(1)
  })
})
