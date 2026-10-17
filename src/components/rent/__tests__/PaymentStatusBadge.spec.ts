import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PaymentStatusBadge from '@/components/rent/PaymentStatusBadge.vue'

describe('PaymentStatusBadge', () => {
  it.each([
    ['paid', 'Paid'],
    ['partially_paid', 'Partially paid'],
    ['unpaid', 'Unpaid'],
  ] as const)('shows %s as %s', (status, label) => {
    const wrapper = mount(PaymentStatusBadge, { props: { status } })

    expect(wrapper.text()).toBe(label)
  })

  // Only lateness takes colour (DueStatusBadge): an unpaid bill may not be due yet.
  it.each(['paid', 'partially_paid', 'unpaid'] as const)('never colours %s', (status) => {
    const classes = mount(PaymentStatusBadge, { props: { status } }).classes()

    expect(classes.some((c) => /text-(success|warning|destructive)/.test(c))).toBe(false)
  })
})
