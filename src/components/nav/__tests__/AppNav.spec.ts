import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppNav from '@/components/nav/AppNav.vue'
import type { NavLink } from '@/types/nav'

const links: NavLink[] = [
  { section: 'home', label: 'Home', href: '/dashboard' },
  { section: 'tenants', label: 'Tenants', href: '/tenants' },
  { section: 'account', label: 'Account', href: '/account' },
]

describe('AppNav', () => {
  it('puts Record in the middle of the bar', () => {
    const bar = mount(AppNav, { props: { links, variant: 'bar' } })

    const items = bar.findAll('li')

    expect(items.map((item) => item.text())).toEqual(['Home', 'Tenants', '', 'Account'])
    expect(items[2]!.find('[data-testid="nav-record"]').exists()).toBe(true)
  })

  it('marks only the current section', () => {
    const bar = mount(AppNav, { props: { links, variant: 'bar', current: 'tenants' } })

    expect(bar.findAll('[aria-current="page"]').map((link) => link.text())).toEqual(['Tenants'])
  })

  it('hands a plain click to the parent instead of loading the page', async () => {
    const nav = mount(AppNav, { props: { links, variant: 'header' } })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })

    nav.get('[data-testid="nav-tenants"]').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nav.emitted('navigate')).toEqual([['tenants']])
  })

  it('leaves a click with a modifier (a new tab) to the browser', () => {
    const nav = mount(AppNav, { props: { links, variant: 'header' } })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })

    nav.get('[data-testid="nav-tenants"]').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(nav.emitted('navigate')).toBeUndefined()
  })

  it('asks to record', async () => {
    const nav = mount(AppNav, { props: { links, variant: 'header' } })

    await nav.get('[data-testid="nav-record"]').trigger('click')

    expect(nav.emitted('record')).toHaveLength(1)
  })
})
