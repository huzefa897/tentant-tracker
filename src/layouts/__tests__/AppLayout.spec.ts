import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import AppLayout from '@/layouts/AppLayout.vue'

function mountLayout() {
  return mount(AppLayout, {
    slots: {
      default: '<p data-testid="page">Page content</p>',
      'header-actions': '<button data-testid="action">Back</button>',
    },
  })
}

describe('AppLayout', () => {
  it('renders the page content and header actions', () => {
    const wrapper = mountLayout()

    expect(wrapper.find('[data-testid="app-content"] [data-testid="page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-header"] [data-testid="action"]').exists()).toBe(true)
  })

  it('fills the screen instead of a narrow centred card', () => {
    const card = mountLayout().get('[data-testid="app-card"]')

    expect(card.classes()).not.toContain('max-w-5xl')
    expect(card.classes()).toContain('w-full')
    expect(card.classes()).toContain('max-w-[1800px]')
  })

  // Each screen mounts its own layout, so this plays on every screen change.
  it('eases the page content in', () => {
    expect(mountLayout().get('[data-testid="app-content"]').classes()).toContain('animate-page-in')
  })
})
