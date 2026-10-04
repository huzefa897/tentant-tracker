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

    expect(wrapper.find('.app-content [data-testid="page"]').exists()).toBe(true)
    expect(wrapper.find('.app-navigation [data-testid="action"]').exists()).toBe(true)
  })

  it('keeps the classes the print styles rely on', () => {
    const wrapper = mountLayout()

    for (const name of ['app-shell', 'app-backdrop', 'app-card', 'app-navigation', 'app-content']) {
      expect(wrapper.find(`.${name}`).exists()).toBe(true)
    }
  })

  it('fills the screen instead of a narrow centred card', () => {
    const card = mountLayout().find('.app-card')

    expect(card.classes()).not.toContain('max-w-5xl')
    expect(card.classes()).toContain('w-full')
    expect(card.classes()).toContain('max-w-[1800px]')
  })
})
