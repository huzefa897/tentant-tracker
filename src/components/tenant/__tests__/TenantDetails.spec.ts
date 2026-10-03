import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TenantDetails from '@/components/tenant/TenantDetails.vue'
import type { Tenant } from '@/types/tenant'

const tenant: Tenant = {
  id: 'tenant-001',
  name: 'Shaik Zahid Ali',
  flatNumber: '202',
  rentAmount: 15000,
  rentDueDay: 11,
  electricityRate: 6,
  mobileNumber: '+918341413827',
  depositAmount: 90000,
}

function details(wrapper: ReturnType<typeof mount>) {
  return Object.fromEntries(
    wrapper.findAll('dl > div').map((tile) => [tile.get('dt').text(), tile.get('dd').text()]),
  )
}

describe('TenantDetails', () => {
  it('shows the tenant name and flat in the header', () => {
    const wrapper = mount(TenantDetails, { props: { tenant } })

    expect(wrapper.get('h2#tenant-name').text()).toBe('Shaik Zahid Ali')
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe('tenant-name')
    expect(wrapper.text()).toContain('Flat 202')
  })

  it('lists every detail, formatted for display', () => {
    const wrapper = mount(TenantDetails, { props: { tenant } })

    expect(details(wrapper)).toEqual({
      'Name of Tenant': 'Shaik Zahid Ali',
      'Rent Amount': '₹15,000',
      'Flat Number': '202',
      'Rent Due Day (of month)': '11th',
      'Electricity Per Unit': '₹6 / unit',
      'Mobile Number': '83414 13827',
      'Deposit Amount': '₹90,000',
    })
  })

  it('updates when the tenant prop changes', async () => {
    const wrapper = mount(TenantDetails, { props: { tenant } })

    await wrapper.setProps({ tenant: { ...tenant, name: 'Mohammed Yusuf', depositAmount: 100000 } })

    expect(details(wrapper)['Deposit Amount']).toBe('₹1,00,000')
    expect(wrapper.get('h2').text()).toBe('Mohammed Yusuf')
  })

  it('emits addEntry and viewHistory from the action buttons', async () => {
    const wrapper = mount(TenantDetails, { props: { tenant } })
    const buttons = wrapper.findAll('button')

    await buttons.find((b) => b.text() === 'Add New Entry')!.trigger('click')
    await buttons.find((b) => b.text() === 'Previous Entries')!.trigger('click')

    expect(wrapper.emitted('addEntry')).toHaveLength(1)
    expect(wrapper.emitted('viewHistory')).toHaveLength(1)
  })
})
