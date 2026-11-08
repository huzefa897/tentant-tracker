import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppLayout from '@/layouts/AppLayout.vue'
import router from '@/router'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { resetTenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  resetAuthService()
  resetAccessService()
  resetTenantService()
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountLayout(slots: Record<string, string> = {}) {
  wrapper = mount(AppLayout, {
    slots: { default: '<p data-testid="page">Page content</p>', ...slots },
    global: { plugins: [router] },
    attachTo: document.body,
  })
  return wrapper
}

describe('AppLayout', () => {
  it('renders the page content inside the card', () => {
    expect(mountLayout().find('[data-testid="app-card"] [data-testid="page"]').exists()).toBe(true)
  })

  it('puts the logo and account menu above the card, not in it', () => {
    const layout = mountLayout()
    const header = layout.get('[data-testid="app-header"]')

    expect(header.text()).toContain('Tenant Manager')
    expect(header.find('[data-testid="user-menu-trigger"]').exists()).toBe(true)
    expect(layout.find('[data-testid="app-card"] [data-testid="app-header"]').exists()).toBe(false)
  })

  it('names the account from /me', async () => {
    signInAs()
    await useAuthStore().init()
    await useAccessStore().load()

    const layout = mountLayout()
    await flushPromises()

    expect(layout.get('[data-testid="user-menu-name"]').text()).toBe('Test Owner')
  })

  it('shows the toolbar at the top of the card', () => {
    const layout = mountLayout({ toolbar: '<input data-testid="search" />' })
    const toolbar = layout.get('[data-testid="app-card"] [data-testid="app-toolbar"]')

    expect(toolbar.find('[data-testid="search"]').exists()).toBe(true)
  })

  it('leaves out the row when a screen has no toolbar', () => {
    expect(mountLayout().find('[data-testid="app-toolbar"]').exists()).toBe(false)
  })

  it('fills the screen instead of a narrow centred card', () => {
    const card = mountLayout().get('[data-testid="app-card"]')

    expect(card.classes()).not.toContain('max-w-5xl')
    expect(card.element.parentElement!.classList).toContain('max-w-[1800px]')
  })

  // Each screen mounts its own layout, so this plays on every screen change.
  it('eases the page content in', () => {
    expect(mountLayout().get('[data-testid="app-content"]').classes()).toContain('animate-page-in')
  })

  describe('nav', () => {
    const body = new DOMWrapper(document.body)

    async function mountSignedIn(path = '/dashboard') {
      signInAs()
      await useAuthStore().init()
      await useAccessStore().load()
      await router.push({ path, force: true })
      const layout = mountLayout()
      await flushPromises()
      return layout
    }

    it('waits for a property before showing the sections', () => {
      const layout = mountLayout()

      expect(layout.find('[data-testid="app-nav-bar"]').exists()).toBe(false)
      expect(layout.find('[data-testid="app-nav-header"]').exists()).toBe(false)
    })

    it('floats Home, Tenants, Record and Account at the bottom, as real links', async () => {
      const bar = (await mountSignedIn()).get('[data-testid="app-nav-bar"]')

      expect(bar.findAll('a').map((link) => [link.text(), link.attributes('href')])).toEqual([
        ['Home', '/dashboard'],
        ['Tenants', '/tenants'],
        ['Account', '/account'],
      ])
      expect(bar.find('[data-testid="nav-record"]').attributes('aria-label')).toBe('Record')
    })

    it('puts Home, Tenants and Record in the header, beside the account menu', async () => {
      const header = (await mountSignedIn()).get('[data-testid="app-header"]')

      expect(header.findAll('[data-testid="app-nav-header"] a').map((a) => a.text())).toEqual([
        'Home',
        'Tenants',
      ])
      expect(header.find('[data-testid="user-menu-trigger"]').exists()).toBe(true)
    })

    it('marks the current section', async () => {
      const bar = (await mountSignedIn('/dashboard')).get('[data-testid="app-nav-bar"]')

      expect(bar.get('[aria-current="page"]').text()).toBe('Home')
    })

    it('navigates in the app on a click', async () => {
      const layout = await mountSignedIn()

      await layout.get('[data-testid="app-nav-bar"] [data-testid="nav-account"]').trigger('click')

      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('account'))
    })

    it('gives way to the keyboard while a field has focus', async () => {
      const layout = await mountSignedIn()
      const bar = layout.get('[data-testid="app-nav-bar"]')
      const input = document.createElement('input')
      layout.get('[data-testid="app-content"]').element.append(input)

      input.focus()
      await flushPromises()
      expect(bar.isVisible()).toBe(false)

      input.blur()
      await flushPromises()
      expect(bar.isVisible()).toBe(true)
      input.remove()
    })

    describe('with a visual viewport', () => {
      const viewport = Object.assign(new EventTarget(), { height: 0, scale: 1 })

      function setViewportHeight(height: number, scale = 1) {
        viewport.height = height
        viewport.scale = scale
        viewport.dispatchEvent(new Event('resize'))
      }

      beforeEach(() => {
        viewport.height = window.innerHeight
        viewport.scale = 1
        Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
      })

      afterEach(() => {
        Reflect.deleteProperty(window, 'visualViewport')
      })

      async function focusedField() {
        const layout = await mountSignedIn()
        const input = document.createElement('input')
        layout.get('[data-testid="app-content"]').element.append(input)
        return { bar: layout.get('[data-testid="app-nav-bar"]'), input }
      }

      it('hides while the keyboard is open over a field, and returns when it is closed', async () => {
        const { bar, input } = await focusedField()

        setViewportHeight(window.innerHeight - 300)
        input.focus()
        await flushPromises()
        expect(bar.isVisible()).toBe(false)

        // The keyboard is dismissed, but the field keeps focus.
        setViewportHeight(window.innerHeight)
        await flushPromises()
        expect(document.activeElement).toBe(input)
        expect(bar.isVisible()).toBe(true)

        input.remove()
      })

      it('stays with a field focused and no keyboard (a hardware keyboard)', async () => {
        const { bar, input } = await focusedField()

        input.focus()
        await flushPromises()

        expect(bar.isVisible()).toBe(true)
        input.remove()
      })

      it('does not take zooming in for a keyboard', async () => {
        const { bar, input } = await focusedField()

        input.focus()
        setViewportHeight(window.innerHeight / 2, 2)
        await flushPromises()

        expect(bar.isVisible()).toBe(true)
        input.remove()
      })
    })

    it('records a bill: what, then for whom, then the new bill page', async () => {
      const layout = await mountSignedIn()

      await layout.get('[data-testid="app-nav-bar"] [data-testid="nav-record"]').trigger('click')
      await flushPromises()
      await body.get('[data-testid="record-bill"]').trigger('click')
      await body.get('button[aria-label="Select tenant"]').trigger('click')
      await flushPromises()
      await body.findAll('[role="option"]')[1]!.trigger('click')

      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-new'))
      expect(router.currentRoute.value.params.tenantId).toBe('tenant-002')
    })
  })
})
