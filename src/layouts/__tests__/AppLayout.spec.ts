import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppLayout from '@/layouts/AppLayout.vue'
import router from '@/router'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  resetAuthService()
  resetAccessService()
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

  it('shows the back link and toolbar in a row at the top of the card', () => {
    const layout = mountLayout({
      back: '<button data-testid="back">Back</button>',
      toolbar: '<input data-testid="search" />',
    })
    const toolbar = layout.get('[data-testid="app-card"] [data-testid="app-toolbar"]')

    expect(toolbar.find('[data-testid="back"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="search"]').exists()).toBe(true)
  })

  it('leaves out the row when a screen has neither', () => {
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
})
