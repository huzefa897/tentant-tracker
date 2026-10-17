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
  startDate: '2025-04-01',
  endDate: null,
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
      Rent: '₹15,000',
      'Due each month': '11th',
      Electricity: '₹6 / unit',
      Deposit: '₹90,000',
      Mobile: '83414 13827',
    })
  })

  it('never repeats the name or flat in the details', () => {
    const wrapper = mount(TenantDetails, { props: { tenant } })

    expect(wrapper.get('dl').text()).not.toContain('Shaik Zahid Ali')
    expect(Object.keys(details(wrapper))).not.toContain('Flat')
  })

  it('links the mobile number for calling', () => {
    const wrapper = mount(TenantDetails, { props: { tenant } })

    expect(wrapper.get('dl a').attributes('href')).toBe('tel:+918341413827')
  })

  it('updates when the tenant prop changes', async () => {
    const wrapper = mount(TenantDetails, { props: { tenant } })

    await wrapper.setProps({ tenant: { ...tenant, name: 'Mohammed Yusuf', depositAmount: 100000 } })

    expect(details(wrapper).Deposit).toBe('₹1,00,000')
    expect(wrapper.get('h2').text()).toBe('Mohammed Yusuf')
  })

  it('emits addEntry and viewEntries from the action buttons', async () => {
    const wrapper = mount(TenantDetails, { props: { tenant } })
    const buttons = wrapper.findAll('button')

    await buttons.find((b) => b.text() === 'New bill')!.trigger('click')
    await buttons.find((b) => b.text() === 'Bills')!.trigger('click')

    expect(wrapper.emitted('addEntry')).toHaveLength(1)
    expect(wrapper.emitted('viewEntries')).toHaveLength(1)
  })

  it('shows the saved entry count on Bills', () => {
    const wrapper = mount(TenantDetails, { props: { tenant, entryCount: 2 } })

    expect(wrapper.text()).toContain('Bills (2)')
  })

  it('shows a count of 0', () => {
    const wrapper = mount(TenantDetails, { props: { tenant, entryCount: 0 } })

    expect(wrapper.text()).toContain('Bills (0)')
  })

  it('leaves out the count while it is unknown', () => {
    const wrapper = mount(TenantDetails, { props: { tenant, entryCount: null } })

    expect(wrapper.text()).toContain('Bills')
    expect(wrapper.text()).not.toContain('Bills (')
  })

  it('shows the latest-entry slot between the name and the details', () => {
    const wrapper = mount(TenantDetails, {
      props: { tenant },
      slots: { 'latest-entry': '<p data-testid="latest">Latest</p>' },
    })
    const html = wrapper.html()

    expect(wrapper.find('[data-testid="latest"]').exists()).toBe(true)
    expect(html.indexOf('tenant-name')).toBeLessThan(html.indexOf('data-testid="latest"'))
    expect(html.indexOf('data-testid="latest"')).toBeLessThan(html.indexOf('<dl'))
  })
})
