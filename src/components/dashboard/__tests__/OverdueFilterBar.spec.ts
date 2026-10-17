import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import OverdueFilterBar from '@/components/dashboard/OverdueFilterBar.vue'

const properties = [
  { id: 'p1', name: 'Saleem Towers' },
  { id: 'p2', name: 'Annex' },
]

function mountBar(
  props: Partial<{
    propertyId: string | null
    month: string | null
    search: string
    properties: typeof properties
  }> = {},
) {
  return mount(OverdueFilterBar, {
    props: {
      properties,
      months: ['2026-10', '2026-09'],
      propertyId: null,
      month: null,
      search: '',
      ...props,
    },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OverdueFilterBar', () => {
  it('sends the search once typing pauses, or at once on Enter', async () => {
    vi.useFakeTimers()
    const bar = mountBar()
    const input = bar.get('[data-testid="overdue-search"]')

    await input.setValue('yus')
    expect(bar.emitted('update:search')).toBeUndefined()
    vi.advanceTimersByTime(300)
    expect(bar.emitted('update:search')).toEqual([['yus']])

    await input.setValue('yusuf')
    await bar.get('form').trigger('submit')
    expect(bar.emitted('update:search')).toEqual([['yus'], ['yusuf']])
    vi.advanceTimersByTime(300)
    expect(bar.emitted('update:search')).toHaveLength(2)
  })

  it('chooses a property and a month, or every one', async () => {
    const bar = mountBar({ month: '2026-09' })
    expect(bar.findAll('[data-testid="filter-summary"]').map((s) => s.text())).toEqual([
      'Property: All',
      'Month: September 2026',
    ])

    await bar.get('[data-testid="overdue-filter-property"]').setValue('p2')
    await bar.get('[data-testid="overdue-filter-month"]').setValue('all')

    expect(bar.emitted('update:propertyId')).toEqual([['p2']])
    expect(bar.emitted('update:month')).toEqual([[null]])
  })

  it('offers no property choice with a single property', () => {
    const bar = mountBar({ properties: [properties[0]!] })

    expect(bar.find('[data-testid="overdue-filter-property"]').exists()).toBe(false)
  })

  it('offers Clear filters only when narrowed, and empties the search', async () => {
    expect(mountBar().find('[data-testid="overdue-clear-filters"]').exists()).toBe(false)

    const bar = mountBar({ search: 'yusuf' })
    await bar.get('[data-testid="overdue-clear-filters"]').trigger('click')

    expect(bar.emitted('clear')).toHaveLength(1)
    expect((bar.get('[data-testid="overdue-search"]').element as HTMLInputElement).value).toBe('')
  })
})
