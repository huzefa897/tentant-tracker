import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PendingTenancyList from '@/components/dashboard/PendingTenancyList.vue'
import { makePendingTenancy } from '@/test/mocks/dashboardService'

const tenancies = [
  makePendingTenancy(),
  makePendingTenancy({
    tenantId: 'tenant-009',
    name: 'Earlier tenant',
    tenancyStatus: 'ended',
    outstanding: 15000,
    overdue: 0,
    pendingBillCount: 1,
    oldestDueDate: null,
    oldestOverdueDate: null,
  }),
]

describe('PendingTenancyList', () => {
  it('shows each tenancy’s overdue, outstanding and oldest unpaid due date, in order', () => {
    const wrapper = mount(PendingTenancyList, { props: { tenancies } })

    const rows = wrapper
      .findAll('[data-testid="pending-row"]')
      .map((row) => row.findAll('th, td').map((cell) => cell.text()))

    expect(rows).toEqual([
      ['Shaik Zahid Ali, Flat 202 · 2 bills', '₹5,750', '₹21,500', '11 Oct 2026', 'View bills'],
      [
        'Earlier tenant, Flat 202 · 1 bill · Ended tenancy',
        '—',
        '₹15,000',
        'No due date',
        'View bills',
      ],
    ])
  })

  it('marks only overdue money in red', () => {
    const wrapper = mount(PendingTenancyList, { props: { tenancies } })
    const [late, onTime] = wrapper.findAll('[data-testid="pending-row"]')

    expect(late!.findAll('td')[0]!.classes()).toContain('text-destructive')
    expect(onTime!.findAll('td')[0]!.classes()).not.toContain('text-destructive')
  })

  it('emits the tenancy to view, from the table and the phone list', async () => {
    const wrapper = mount(PendingTenancyList, { props: { tenancies } })

    await wrapper.findAll('[data-testid="pending-row"] button')[1]!.trigger('click')
    await wrapper.findAll('[data-testid="pending-card"] button')[0]!.trigger('click')

    expect(wrapper.emitted('view')).toEqual([['tenant-009'], ['tenant-001']])
    expect(wrapper.get('[data-testid="pending-card"] button').attributes('aria-label')).toBe(
      'View the unpaid bills of Shaik Zahid Ali · Flat 202',
    )
  })
})
