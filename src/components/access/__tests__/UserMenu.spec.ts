import { afterEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import UserMenu from '@/components/access/UserMenu.vue'
import { openUserMenu } from '@/test/userMenu'

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountMenu(props: { name: string; phoneNumber: string; canSwitchProperty?: boolean }) {
  wrapper = mount(UserMenu, { props, attachTo: document.body })
  return wrapper
}

// The menu renders in a portal, outside the component.
const body = () => new DOMWrapper(document.body)

describe('UserMenu', () => {
  it('shows the name and its initials', () => {
    const menu = mountMenu({ name: 'Test Owner', phoneNumber: '+918341413827' })

    expect(menu.get('[data-testid="user-menu-name"]').text()).toBe('Test Owner')
    expect(menu.get('[data-testid="user-menu-trigger"]').text()).toContain('TO')
  })

  it('falls back to the phone number when no name is set', () => {
    const menu = mountMenu({ name: '  ', phoneNumber: '+918341413827' })

    expect(menu.get('[data-testid="user-menu-name"]').text()).toBe('+91 83414 13827')
  })

  it('emits logout from the menu', async () => {
    const menu = mountMenu({ name: 'Test Owner', phoneNumber: '+918341413827' })

    await openUserMenu()
    expect(body().text()).toContain('+91 83414 13827')
    await body().get('[data-testid="user-menu-logout"]').trigger('click')
    await flushPromises()

    expect(menu.emitted('logout')).toHaveLength(1)
  })

  it('offers switching property only when allowed', async () => {
    const menu = mountMenu({ name: 'Test Owner', phoneNumber: '+918341413827' })
    await openUserMenu()
    expect(body().find('[data-testid="user-menu-switch-property"]').exists()).toBe(false)

    await menu.setProps({ canSwitchProperty: true })
    await body().get('[data-testid="user-menu-switch-property"]').trigger('click')
    await flushPromises()

    expect(menu.emitted('switch-property')).toHaveLength(1)
  })
})
