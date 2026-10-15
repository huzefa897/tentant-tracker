import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DueFilterGroup from '@/components/dashboard/DueFilterGroup.vue'
import type { DueFilter } from '@/types/dashboard'

describe('DueFilterGroup', () => {
  it('presses the chosen filter and emits another', async () => {
    const wrapper = mount(DueFilterGroup, { props: { modelValue: 'all' as DueFilter } })

    expect(wrapper.findAll('button').map((b) => [b.text(), b.attributes('aria-pressed')])).toEqual([
      ['All pending', 'true'],
      ['Overdue', 'false'],
      ['Due today', 'false'],
      ['Next 7 days', 'false'],
    ])

    await wrapper.get('[data-testid="due-filter-due_next_7_days"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['due_next_7_days']])
  })
})
