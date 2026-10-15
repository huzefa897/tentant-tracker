import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { dashboardService } from '@/services/dashboard.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { DASHBOARD_LOAD_ERROR_MESSAGE, useDashboardStore } from '@/stores/dashboard'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeDashboard, makeSummary, pendingPage } from '@/test/mocks/dashboardService'
import type { DashboardSummary } from '@/types/dashboard'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))

const annex = { id: '6f1c2a4e-0000-4000-8000-000000000002', name: 'Annex', role: 'owner' as const }

async function signIn() {
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  resetAuthService()
  resetAccessService()
  await signIn()
})

describe('dashboard store', () => {
  it('loads the totals, the first page of who owes and the missing bills together', async () => {
    const store = useDashboardStore()

    await store.refresh()

    expect(store.status).toBe('ready')
    expect(store.summary?.outstanding).toBe(39500)
    expect(store.pending?.tenancies.map((t) => t.tenantId)).toEqual(['tenant-001', 'tenant-002'])
    expect(store.missing?.billingMonth).toBe('2026-09')
    expect(store.loadedAt).not.toBeNull()
  })

  it('is an error, never zeros, when the first load fails', async () => {
    vi.mocked(dashboardService.getPendingTenancies).mockRejectedValueOnce(
      new ApiError('unknown', 'boom'),
    )
    const store = useDashboardStore()

    await store.refresh()

    expect(store.status).toBe('error')
    expect(store.error).toBe(DASHBOARD_LOAD_ERROR_MESSAGE)
    expect(store.summary).toBeNull()
    expect(store.loaded).toBe(false)
  })

  it('keeps everything shown, and when it was loaded, when a refresh fails', async () => {
    const store = useDashboardStore()
    await store.refresh()
    const loadedAt = store.loadedAt
    fakeDashboard.summary = makeSummary({ outstanding: 1 })
    vi.mocked(dashboardService.getMissingBills).mockRejectedValueOnce(
      new ApiError('network', 'offline'),
    )

    await store.refresh()

    // Not even the summary that did arrive: the screen never mixes two moments.
    expect(store.summary?.outstanding).toBe(39500)
    expect(store.loadedAt).toBe(loadedAt)
    expect(store.status).toBe('ready')
    expect(store.refreshError).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    )
    expect(store.refreshing).toBe(false)

    await store.refresh()

    expect(store.refreshError).toBeNull()
    expect(store.summary?.outstanding).toBe(1)
  })

  it('never sends a second refresh while one is running', async () => {
    const pending = deferred<DashboardSummary>()
    vi.mocked(dashboardService.getSummary).mockReturnValueOnce(pending.promise)
    const store = useDashboardStore()

    const first = store.refresh()
    const second = store.refresh()
    expect(store.refreshing).toBe(true)
    pending.resolve(makeSummary())
    await Promise.all([first, second])

    expect(dashboardService.getSummary).toHaveBeenCalledTimes(1)
    expect(store.refreshing).toBe(false)
  })

  it('reloads only the list for a filter or page, from the first page', async () => {
    const store = useDashboardStore()
    await store.refresh()
    store.goToPage(2)

    store.setDueFilter('overdue')
    await vi.waitFor(() => expect(store.pendingStatus).toBe('ready'))

    expect(store.page).toBe(1)
    expect(dashboardService.getPendingTenancies).toHaveBeenLastCalledWith(testProperty.id, {
      due: 'overdue',
      page: 1,
    })
    expect(store.pending?.tenancies.map((t) => t.tenantId)).toEqual(['tenant-001'])
    expect(dashboardService.getSummary).toHaveBeenCalledTimes(1)
  })

  it('shows only the newest filter’s rows when responses arrive out of order', async () => {
    const store = useDashboardStore()
    await store.refresh()
    const slow = deferred<ReturnType<typeof pendingPage>>()
    vi.mocked(dashboardService.getPendingTenancies).mockReturnValueOnce(slow.promise)

    store.setDueFilter('overdue')
    store.setDueFilter('due_next_7_days')
    await vi.waitFor(() => expect(store.pendingStatus).toBe('ready'))
    slow.resolve(pendingPage({ due: 'overdue' }))
    await Promise.resolve()

    expect(store.pending?.tenancies.map((t) => t.tenantId)).toEqual(['tenant-002'])
  })

  it('reports a failed list reload apart, keeping the totals', async () => {
    const store = useDashboardStore()
    await store.refresh()
    vi.mocked(dashboardService.getPendingTenancies).mockRejectedValueOnce(
      new ApiError('unavailable', 'down'),
    )

    store.setDueFilter('overdue')
    await vi.waitFor(() => expect(store.pendingStatus).toBe('error'))

    expect(store.pendingError).toBe(
      'Pending payments are unavailable right now. Please try again shortly.',
    )
    expect(store.summary?.outstanding).toBe(39500)
  })

  it('loads another month’s missing bills on its own', async () => {
    const store = useDashboardStore()
    await store.refresh()

    store.setMissingMonth('2026-08')
    await vi.waitFor(() => expect(store.missingStatus).toBe('ready'))

    expect(store.missing?.billingMonth).toBe('2026-08')
    expect(dashboardService.getSummary).toHaveBeenCalledTimes(1)
  })

  it('forgets everything when the property changes, discarding a refresh in flight', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
    setActivePinia(createPinia())
    await signIn()
    useAccessStore().selectProperty(testProperty.id)
    const store = useDashboardStore()
    const slow = deferred<DashboardSummary>()
    vi.mocked(dashboardService.getSummary).mockReturnValueOnce(slow.promise)

    const running = store.refresh()
    useAccessStore().selectProperty(annex.id)
    slow.resolve(makeSummary())
    await running

    expect(store.summary).toBeNull()
    expect(store.status).toBe('idle')
    expect(store.refreshing).toBe(false)
  })
})
