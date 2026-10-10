import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutoRetry } from '@/composables/useAutoRetry'

function makeWrapper(initialStatus: string) {
  const status = ref(initialStatus)
  const retry = vi.fn()

  const Comp = defineComponent({
    setup() {
      useAutoRetry(status, retry)
      return {}
    },
    template: '<div/>',
  })

  const wrapper = mount(Comp)
  return { status, retry, wrapper }
}

describe('useAutoRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules retry after 5 s on the first error', async () => {
    const { retry } = makeWrapper('error')
    await flushPromises()

    vi.advanceTimersByTime(4_999)
    expect(retry).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(retry).toHaveBeenCalledOnce()
  })

  it('does not schedule retry when status is not error', async () => {
    const { retry } = makeWrapper('loading')
    await flushPromises()

    vi.advanceTimersByTime(30_000)
    expect(retry).not.toHaveBeenCalled()
  })

  it('cancels any pending timer when status leaves error', async () => {
    const { status, retry } = makeWrapper('error')
    await flushPromises()

    vi.advanceTimersByTime(3_000)
    status.value = 'loading'
    await flushPromises()

    vi.advanceTimersByTime(10_000)
    expect(retry).not.toHaveBeenCalled()
  })

  it('doubles the delay on each consecutive error (exponential backoff)', async () => {
    const { status, retry } = makeWrapper('error')
    await flushPromises()

    // Attempt 1: 5 s
    vi.advanceTimersByTime(5_000)
    expect(retry).toHaveBeenCalledTimes(1)

    // loading → error (attempt 2 → 10 s)
    status.value = 'loading'
    await flushPromises()
    status.value = 'error'
    await flushPromises()

    vi.advanceTimersByTime(9_999)
    expect(retry).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(retry).toHaveBeenCalledTimes(2)

    // loading → error (attempt 3 → 20 s)
    status.value = 'loading'
    await flushPromises()
    status.value = 'error'
    await flushPromises()

    vi.advanceTimersByTime(20_000)
    expect(retry).toHaveBeenCalledTimes(3)
  })

  it('caps the delay at 30 s', async () => {
    const { status, retry } = makeWrapper('error')
    await flushPromises()

    // Burn through 5 s → 10 s → 20 s to reach the 30 s cap
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(30_000)
      status.value = 'loading'
      await flushPromises()
      status.value = 'error'
      await flushPromises()
    }
    retry.mockClear()

    vi.advanceTimersByTime(29_999)
    expect(retry).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(retry).toHaveBeenCalledOnce()
  })

  it('resets backoff after a successful load', async () => {
    const { status, retry } = makeWrapper('error')
    await flushPromises()

    // Two errors to advance the backoff (5 s + 10 s)
    vi.advanceTimersByTime(5_000)
    status.value = 'loading'
    await flushPromises()
    status.value = 'error'
    await flushPromises()
    vi.advanceTimersByTime(10_000)
    expect(retry).toHaveBeenCalledTimes(2)

    // Success resets the counter
    status.value = 'ready'
    await flushPromises()
    retry.mockClear()

    // Next error should restart at 5 s, not 20 s
    status.value = 'error'
    await flushPromises()

    vi.advanceTimersByTime(4_999)
    expect(retry).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(retry).toHaveBeenCalledOnce()
  })

  it('stops retrying on unmount', async () => {
    const { retry, wrapper } = makeWrapper('error')
    await flushPromises()

    wrapper.unmount()
    vi.advanceTimersByTime(30_000)
    expect(retry).not.toHaveBeenCalled()
  })
})
