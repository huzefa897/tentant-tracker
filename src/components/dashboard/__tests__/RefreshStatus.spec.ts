import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RefreshStatus from '@/components/dashboard/RefreshStatus.vue'

const LOADED = new Date(2026, 9, 15, 18, 30).getTime()

afterEach(() => {
  vi.useRealTimers()
})

describe('RefreshStatus', () => {
  it('says how long ago it was updated, moving on by itself', async () => {
    vi.useFakeTimers({ now: LOADED + 10_000 })
    const wrapper = mount(RefreshStatus, {
      props: { loadedAt: LOADED, refreshing: false, error: null },
    })

    expect(wrapper.get('[data-testid="updated-at"]').text()).toBe('Updated just now')
    await vi.advanceTimersByTimeAsync(120_000)

    expect(wrapper.get('[data-testid="updated-at"]').text()).toBe('Updated 2 minutes ago')
  })

  it('emits Refresh, and is disabled while refreshing', async () => {
    const wrapper = mount(RefreshStatus, {
      props: { loadedAt: LOADED, refreshing: false, error: null },
    })

    await wrapper.get('[data-testid="refresh"]').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)

    await wrapper.setProps({ refreshing: true })
    expect(wrapper.get('[data-testid="refresh"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="updated-at"]').text()).toBe('Refreshing…')
  })

  it('says a refresh failed and when the figures shown are from', () => {
    const wrapper = mount(RefreshStatus, {
      props: { loadedAt: LOADED, refreshing: false, error: 'offline' },
    })

    expect(wrapper.get('[data-testid="refresh-error"]').text()).toBe(
      'Couldn’t refresh. Showing data from 6:30 pm.',
    )
    expect(wrapper.get('[data-testid="refresh-error"]').attributes('role')).toBe('alert')
  })
})
