import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'

describe('PaymentStatusBadge', () => {
  it.each([
    ['paid', 'Paid', 'text-success'],
    ['partially_paid', 'Partially paid', 'text-warning'],
    ['unpaid', 'Unpaid', 'text-destructive'],
  ] as const)('shows %s as %s', (status, label, colour) => {
    const wrapper = mount(PaymentStatusBadge, { props: { status } })

    expect(wrapper.text()).toBe(label)
    expect(wrapper.classes()).toContain(colour)
  })
})
