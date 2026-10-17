import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EntryStatusBadge from '@/components/rent/EntryStatusBadge.vue'

describe('EntryStatusBadge', () => {
  it('shows an active bill’s payment status', () => {
    const wrapper = mount(EntryStatusBadge, {
      props: { entry: { billStatus: 'active', status: 'partially_paid', dueStatus: 'upcoming' } },
    })

    expect(wrapper.text()).toBe('Partially paid')
    expect(wrapper.find('[data-testid="void-badge"]').exists()).toBe(false)
  })

  it('shows Overdue beside the payment status when the money is late', () => {
    const wrapper = mount(EntryStatusBadge, {
      props: { entry: { billStatus: 'active', status: 'partially_paid', dueStatus: 'overdue' } },
    })

    expect(wrapper.text()).toContain('Partially paid')
    expect(wrapper.get('[data-testid="due-status-badge"]').text()).toBe('Overdue')
  })

  it('shows VOID for a void bill, never a payment or due status', () => {
    const wrapper = mount(EntryStatusBadge, {
      props: { entry: { billStatus: 'void', status: null, dueStatus: null } },
    })

    expect(wrapper.get('[data-testid="void-badge"]').text()).toBe('Void')
    expect(wrapper.text()).not.toMatch(/paid|due/i)
  })
})
