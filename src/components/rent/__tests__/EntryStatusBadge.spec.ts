import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EntryStatusBadge from '@/components/rent/EntryStatusBadge.vue'

describe('EntryStatusBadge', () => {
  it('shows an active bill’s payment status', () => {
    const wrapper = mount(EntryStatusBadge, {
      props: { entry: { billStatus: 'active', status: 'partially_paid' } },
    })

    expect(wrapper.text()).toBe('Partially paid')
    expect(wrapper.find('[data-testid="void-badge"]').exists()).toBe(false)
  })

  it('shows VOID for a void bill, never a payment status', () => {
    const wrapper = mount(EntryStatusBadge, {
      props: { entry: { billStatus: 'void', status: null } },
    })

    expect(wrapper.get('[data-testid="void-badge"]').text()).toBe('Void')
    expect(wrapper.text()).not.toMatch(/paid/i)
  })
})
