import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MissingBillsList from '@/components/dashboard/MissingBillsList.vue'
import MonthStepper from '@/components/dashboard/MonthStepper.vue'

const missing = {
  billingMonth: '2026-09',
  tenancies: [
    {
      tenantId: 'tenant-003',
      name: 'Ali Hussain',
      flatNumber: '102',
      tenancyStatus: 'ended' as const,
      rentAmount: 14000,
    },
  ],
}

describe('MissingBillsList', () => {
  it('lists each tenancy and emits Create bill for it and the month', async () => {
    const wrapper = mount(MissingBillsList, { props: { missing } })

    expect(wrapper.get('[data-testid="missing-row"]').text()).toContain(
      'Flat 102 · rent ₹14,000 · Ended tenancy',
    )
    const create = wrapper.get('[data-testid="missing-row"] button')
    expect(create.attributes('aria-label')).toBe(
      'Create the September 2026 bill for Ali Hussain, Flat 102',
    )

    await create.trigger('click')

    expect(wrapper.emitted('create')).toEqual([['tenant-003', '2026-09']])
  })

  it('says when every occupied flat has its bill', () => {
    const wrapper = mount(MissingBillsList, { props: { missing: { ...missing, tenancies: [] } } })

    expect(wrapper.get('[data-testid="missing-none"]').text()).toBe(
      'Every occupied flat has a bill for September 2026.',
    )
  })
})

describe('MonthStepper', () => {
  it('steps a month back and forward, across years', async () => {
    const wrapper = mount(MonthStepper, { props: { modelValue: '2026-01' } })

    expect(wrapper.text()).toContain('January 2026')
    await wrapper.get('button[aria-label="Previous month"]').trigger('click')
    await wrapper.setProps({ modelValue: '2026-12' })
    await wrapper.get('button[aria-label="Next month"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['2025-12'], ['2027-01']])
  })
})
