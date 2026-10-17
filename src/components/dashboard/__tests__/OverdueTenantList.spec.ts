import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import OverdueTenantList from '@/components/dashboard/OverdueTenantList.vue'
import { makeOverdueBill, makeOverdueTenant } from '@/test/mocks/dashboardService'

const yusuf = makeOverdueTenant({
  tenantId: 'tenant-002',
  name: 'Mohammed Yusuf',
  flatNumber: '301',
  tenancyStatus: 'ended',
  bills: [
    makeOverdueBill({
      id: 'entry-002',
      billingMonth: '2026-08',
      dueDate: '2026-09-10',
      daysOverdue: 35,
      paidAmount: 0,
      outstanding: 15750,
    }),
    makeOverdueBill({ id: 'entry-003', daysOverdue: 1 }),
  ],
})

function mountList(showProperty = false) {
  return mount(OverdueTenantList, { props: { tenants: [yusuf], showProperty } })
}

describe('OverdueTenantList', () => {
  it('keeps the table to laptops, where its amounts have room, and rows below that', () => {
    const list = mountList()
    const table = list.get('[data-testid="overdue-bill-table"]')
    const items = list.get('[data-testid="overdue-bill-items"]')

    // At sm and md the fixed columns leave too little for Total, Paid and Balance.
    expect(table.classes()).toEqual(expect.arrayContaining(['hidden', 'lg:block']))
    expect(table.classes()).toContain('overflow-x-auto')
    expect(table.classes().some((name) => /^(sm|md):/.test(name))).toBe(false)
    expect(items.classes()).toContain('lg:hidden')
    expect(items.classes().some((name) => /^(sm|md):hidden$/.test(name))).toBe(false)
  })

  it('shows each tenant with their count, total and every overdue month', () => {
    const list = mountList()
    const tenant = list.get('[data-testid="overdue-tenant"]')

    expect(tenant.get('h3').text()).toBe('Mohammed Yusuf')
    expect(tenant.text()).toContain('Flat 301 · Ended tenancy')
    expect(tenant.text()).not.toContain('Test Towers')
    expect(tenant.get('[data-testid="overdue-tenant-outstanding"]').text()).toBe('₹21,500')
    expect(tenant.text()).toContain('2 overdue bills')
    expect(
      tenant
        .findAll('[data-testid="overdue-bill"]')
        .map((row) => [row.get('th'), ...row.findAll('td').slice(0, 4)].map((cell) => cell.text())),
    ).toEqual([
      ['August 2026', '10 Sept 2026 Overdue 35 days', '₹15,750', '₹0', '₹15,750'],
      ['September 2026', '11 Oct 2026 Overdue 1 day', '₹15,750', '₹10,000', '₹5,750'],
    ])
    // The same months for phones.
    expect(tenant.findAll('[data-testid="overdue-bill-item"]')).toHaveLength(2)
  })

  it('names the property when there are several', () => {
    expect(mountList(true).text()).toContain('Test Towers · Flat 301')
  })

  it('opens a bill, or the tenant’s bills', async () => {
    const list = mountList()

    await list.get('[data-testid="overdue-bill"] button').trigger('click')
    await list.get('[data-testid="overdue-bill-item"] button').trigger('click')
    await list.get('[data-testid="overdue-tenant-name"]').trigger('click')

    expect(list.emitted('viewBill')).toEqual([
      [yusuf, yusuf.bills[0]],
      [yusuf, yusuf.bills[0]],
    ])
    expect(list.emitted('viewTenant')).toEqual([[yusuf]])
  })
})
