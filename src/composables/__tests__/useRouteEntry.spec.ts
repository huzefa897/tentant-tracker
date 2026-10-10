import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRouteEntry } from '@/composables/useRouteEntry'
import { ApiError } from '@/services/apiError'
import { noteRateLimited, resetRateLimit } from '@/services/rateLimit'
import { rentEntryService } from '@/services/rentEntry.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { ENTRIES_LOAD_ERROR_MESSAGE } from '@/stores/rentEntry'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { makeEntry } from '@/test/rentEntries'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))

const getEntry = vi.mocked(rentEntryService.getEntry)

function mountWith(tenantId: Ref<string>, entryId: Ref<string>) {
  let result!: ReturnType<typeof useRouteEntry>
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useRouteEntry(tenantId, entryId)
        return () => null
      },
    }),
  )
  return { ...result, wrapper }
}

beforeEach(async () => {
  vi.useFakeTimers()
  resetRateLimit()
  resetAuthService()
  resetAccessService()
  resetRentEntryService()
  fakeEntries.entries = [
    makeEntry({ id: 'sep', billingMonth: '2026-09' }),
    makeEntry({ id: 'oct', billingMonth: '2026-10' }),
    makeEntry({ id: 'other', tenantId: 'tenant-002' }),
  ]
  setActivePinia(createPinia())
  // As the route guards leave it: signed in with the test property selected.
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRouteEntry', () => {
  it('loads the bill in the URL from the backend', async () => {
    const entry = mountWith(ref('tenant-001'), ref('sep'))
    expect(entry.status.value).toBe('loading')

    await flushPromises()

    expect(getEntry).toHaveBeenCalledWith(expect.any(String), 'tenant-001', 'sep')
    expect(entry.status.value).toBe('ready')
    expect(entry.entry.value?.billingMonth).toBe('2026-09')
  })

  it('reports another tenant’s bill, or none, as missing', async () => {
    const other = mountWith(ref('tenant-001'), ref('other'))
    const unknown = mountWith(ref('tenant-001'), ref('nope'))
    await flushPromises()

    expect(other.status.value).toBe('missing')
    expect(other.entry.value).toBeNull()
    expect(unknown.status.value).toBe('missing')
  })

  it('reports a failed load as an error, not as missing, and retries', async () => {
    getEntry.mockRejectedValueOnce(new ApiError('unknown'))
    const entry = mountWith(ref('tenant-001'), ref('sep'))
    await flushPromises()

    expect(entry.status.value).toBe('error')
    expect(entry.error.value).toBe(ENTRIES_LOAD_ERROR_MESSAGE)

    await entry.retry()

    expect(entry.status.value).toBe('ready')
    expect(entry.error.value).toBeNull()
  })

  it('loads again when the ids in the URL change', async () => {
    const entryId = ref('sep')
    const { status, entry } = mountWith(ref('tenant-001'), entryId)
    await flushPromises()

    entryId.value = 'oct'
    expect(status.value).toBe('loading')
    await flushPromises()

    expect(entry.value?.billingMonth).toBe('2026-10')
  })

  it('does not schedule a retry when unmount happens while a load is in flight', async () => {
    let rejectLoad!: () => void
    getEntry.mockReturnValueOnce(
      new Promise((_, reject) => (rejectLoad = () => reject(new Error('network')))),
    )
    const { wrapper } = mountWith(ref('tenant-001'), ref('sep'))

    wrapper.unmount()
    rejectLoad()
    await flushPromises()

    vi.advanceTimersByTime(30_000)
    // getEntry was called once on mount; it must not be called again after unmount
    expect(getEntry).toHaveBeenCalledTimes(1)
  })

  it('does not retry and marks retryable=false on unauthorized errors', async () => {
    getEntry.mockRejectedValueOnce(new ApiError('unauthorized'))
    const { status, retryable } = mountWith(ref('tenant-001'), ref('sep'))
    await flushPromises()

    expect(status.value).toBe('error')
    expect(retryable.value).toBe(false)

    vi.advanceTimersByTime(30_000)
    expect(getEntry).toHaveBeenCalledTimes(1)
  })

  it('retries and marks retryable=true on transient errors', async () => {
    getEntry.mockRejectedValueOnce(new ApiError('unavailable'))
    const { status, retryable } = mountWith(ref('tenant-001'), ref('sep'))
    await flushPromises()

    expect(status.value).toBe('error')
    expect(retryable.value).toBe(true)

    vi.advanceTimersByTime(10_000)
    await flushPromises()
    expect(getEntry).toHaveBeenCalledTimes(2)
  })

  it('waits for the Retry-After window before retrying a rate-limited load', async () => {
    // As the API client records it when the 429 arrives.
    getEntry.mockImplementationOnce(async () => {
      noteRateLimited('45')
      throw new ApiError('rate-limited')
    })
    const { status, retryable } = mountWith(ref('tenant-001'), ref('sep'))
    await flushPromises()

    expect(status.value).toBe('error')
    expect(retryable.value).toBe(true)

    vi.advanceTimersByTime(44_999)
    await flushPromises()
    expect(getEntry).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(getEntry).toHaveBeenCalledTimes(2)
  })
})
