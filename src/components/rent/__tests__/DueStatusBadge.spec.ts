import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DueStatusBadge from '@/components/rent/DueStatusBadge.vue'

describe('DueStatusBadge', () => {
  it.each([
    ['overdue', 'Overdue', 'text-destructive'],
    ['due_today', 'Due today', 'text-warning'],
  ] as const)('flags %s money as %s', (status, label, colour) => {
    const badge = mount(DueStatusBadge, { props: { status } }).get(
      '[data-testid="due-status-badge"]',
    )

    expect(badge.text()).toBe(label)
    expect(badge.classes()).toContain(colour)
  })

  it.each(['upcoming', 'settled', null] as const)('shows nothing for %s', (status) => {
    expect(mount(DueStatusBadge, { props: { status } }).text()).toBe('')
  })
})
