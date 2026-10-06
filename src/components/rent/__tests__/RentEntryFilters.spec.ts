import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentEntryFilters from '@/components/rent/RentEntryFilters.vue'

function mountFilters(year = 'all') {
  return mount(RentEntryFilters, { props: { years: ['2026', '2025'], year } })
}

describe('RentEntryFilters', () => {
  it('offers all years plus the given ones, and no status filter yet', () => {
    const wrapper = mountFilters()

    expect(wrapper.findAll('#filter-year option').map((o) => o.text())).toEqual([
      'All years',
      '2026',
      '2025',
    ])
    expect(wrapper.find('#filter-status').exists()).toBe(false)
  })

  it('emits the chosen year', async () => {
    const wrapper = mountFilters()

    await wrapper.get('#filter-year').setValue('2025')

    expect(wrapper.emitted('update:year')).toEqual([['2025']])
  })

  it('shows Clear filters only while a year is chosen, and resets it', async () => {
    expect(mountFilters().text()).not.toContain('Clear filters')

    const wrapper = mountFilters('2026')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Clear filters')!
      .trigger('click')

    expect(wrapper.emitted('update:year')).toEqual([['all']])
  })
})
