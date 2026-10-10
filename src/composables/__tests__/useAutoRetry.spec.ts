import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAutoRetry } from '@/composables/useAutoRetry'
import { noteRateLimited, resetRateLimit } from '@/services/rateLimit'

function makeWrapper(initialStatus: string, retryable = true) {
  const status = ref(initialStatus)
  const retryableRef = ref(retryable)
  const retry = vi.fn()

  const Comp = defineComponent({
    setup() {
      useAutoRetry(status, retry, retryableRef)
      return {}
    },
    template: '<div/>',
  })

  const wrapper = mount(Comp)
  return { status, retryable: retryableRef, retry, wrapper }
}

describe('useAutoRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetRateLimit()
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

  describe('online event', () => {
    it('retries immediately when the browser comes back online', async () => {
      const { retry } = makeWrapper('error')
      await flushPromises()

      window.dispatchEvent(new Event('online'))
      expect(retry).toHaveBeenCalledOnce()
    })

    it('does not retry on online event when status is not error', async () => {
      const { retry } = makeWrapper('loading')
      await flushPromises()

      window.dispatchEvent(new Event('online'))
      expect(retry).not.toHaveBeenCalled()
    })

    it('cancels the pending timer when online fires', async () => {
      const { retry } = makeWrapper('error')
      await flushPromises()

      vi.advanceTimersByTime(3_000)
      window.dispatchEvent(new Event('online'))
      expect(retry).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(10_000)
      expect(retry).toHaveBeenCalledOnce()
    })
  })

  describe('visibilitychange event', () => {
    afterEach(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
    })

    it('retries immediately when the tab becomes visible', async () => {
      const { retry } = makeWrapper('error')
      await flushPromises()

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(retry).toHaveBeenCalledOnce()
    })

    it('does not retry when the tab is hidden', async () => {
      const { retry } = makeWrapper('error')
      await flushPromises()

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(retry).not.toHaveBeenCalled()
    })

    it('does not retry on visibilitychange when status is not error', async () => {
      const { retry } = makeWrapper('loading')
      await flushPromises()

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(retry).not.toHaveBeenCalled()
    })
  })

  describe('retryable=false', () => {
    it('does not schedule a timer when retryable is false', async () => {
      const { retry } = makeWrapper('error', false)
      await flushPromises()

      vi.advanceTimersByTime(30_000)
      expect(retry).not.toHaveBeenCalled()
    })

    it('does not retry on online event when retryable is false', async () => {
      const { retry } = makeWrapper('error', false)
      await flushPromises()

      window.dispatchEvent(new Event('online'))
      expect(retry).not.toHaveBeenCalled()
    })

    it('does not retry on visibilitychange event when retryable is false', async () => {
      const { retry } = makeWrapper('error', false)
      await flushPromises()

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
      document.dispatchEvent(new Event('visibilitychange'))
      expect(retry).not.toHaveBeenCalled()
    })
  })

  describe('after a 429', () => {
    it('waits for the Retry-After window instead of the backoff', async () => {
      noteRateLimited('60')
      const { retry } = makeWrapper('error')
      await flushPromises()

      vi.advanceTimersByTime(59_999)
      expect(retry).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(retry).toHaveBeenCalledOnce()
    })

    it('honors a rate limit recorded after the retry timer was scheduled', async () => {
      const { retry } = makeWrapper('error')
      await flushPromises()

      vi.advanceTimersByTime(1_000)
      noteRateLimited('60')

      vi.advanceTimersByTime(59_999)
      expect(retry).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(retry).toHaveBeenCalledOnce()
    })

    it('does not retry early on online or visibilitychange events', async () => {
      noteRateLimited('60')
      const { retry } = makeWrapper('error')
      await flushPromises()

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })
      window.dispatchEvent(new Event('online'))
      document.dispatchEvent(new Event('visibilitychange'))
      expect(retry).not.toHaveBeenCalled()

      // The scheduled retry still runs once the window has passed.
      vi.advanceTimersByTime(60_000)
      expect(retry).toHaveBeenCalledOnce()
    })

    it('retries on those events again once the window has passed', async () => {
      noteRateLimited('5')
      const { status, retry } = makeWrapper('error')
      await flushPromises()
      vi.advanceTimersByTime(5_000)
      expect(retry).toHaveBeenCalledOnce()

      status.value = 'loading'
      await flushPromises()
      status.value = 'error'
      await flushPromises()
      window.dispatchEvent(new Event('online'))
      expect(retry).toHaveBeenCalledTimes(2)
    })
  })
})
