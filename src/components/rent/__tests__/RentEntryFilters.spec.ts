import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentEntryFilters from '@/components/rent/RentEntryFilters.vue'
import type { PaymentStatus } from '@/types/rentEntry'

function mountFilters(year = 'all', status: PaymentStatus | 'all' = 'all', showVoid = false) {
  return mount(RentEntryFilters, { props: { years: ['2026', '2025'], year, status, showVoid } })
}

describe('RentEntryFilters', () => {
  it('offers all years plus the given ones, and every status', () => {
    const wrapper = mountFilters()

    expect(wrapper.findAll('#filter-year option').map((o) => o.text())).toEqual([
      'All years',
      '2026',
      '2025',
    ])
    expect(wrapper.findAll('#filter-status option').map((o) => o.text())).toEqual([
      'All',
      'Unpaid',
      'Partially paid',
      'Paid',
    ])
  })

  it('emits the chosen year and status', async () => {
    const wrapper = mountFilters()

    await wrapper.get('#filter-year').setValue('2025')
    await wrapper.get('#filter-status').setValue('partially_paid')

    expect(wrapper.emitted('update:year')).toEqual([['2025']])
    expect(wrapper.emitted('update:status')).toEqual([['partially_paid']])
  })

  it('shows Clear filters only while a filter is active, and resets both', async () => {
    expect(mountFilters().text()).not.toContain('Clear filters')

    const wrapper = mountFilters('2026', 'unpaid')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Clear filters')!
      .trigger('click')

    expect(wrapper.emitted('update:year')).toEqual([['all']])
    expect(wrapper.emitted('update:status')).toEqual([['all']])
  })

  it('shows each filter’s name and current value', () => {
    const summaries = (wrapper: ReturnType<typeof mountFilters>) =>
      wrapper.findAll('[data-testid="filter-summary"]').map((s) => s.text())

    expect(summaries(mountFilters())).toEqual(['Billing period: All', 'Status: All'])
    expect(summaries(mountFilters('2025', 'partially_paid'))).toEqual([
      'Billing period: 2025',
      'Status: Partially paid',
    ])
    expect(mountFilters().get('#filter-year').attributes('aria-label')).toBe('Billing period')
    expect((mountFilters('2025').get('#filter-year').element as HTMLSelectElement).value).toBe(
      '2025',
    )
  })

  it('hides void bills unless switched on, apart from Clear filters', async () => {
    const wrapper = mountFilters('2026')
    const toggle = wrapper.get('#filter-show-void')
    expect(toggle.attributes('role')).toBe('switch')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(wrapper.get('label[for="filter-show-void"]').text()).toBe('Include void bills')

    await toggle.trigger('click')
    expect(wrapper.emitted('update:showVoid')).toEqual([[true]])

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Clear filters')!
      .trigger('click')
    expect(wrapper.emitted('update:showVoid')).toHaveLength(1)
  })
})
