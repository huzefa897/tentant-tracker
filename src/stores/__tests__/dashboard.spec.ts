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
import { fakeDashboard, makeSummary, periodPage } from '@/test/mocks/dashboardService'
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

const months = (store: ReturnType<typeof useDashboardStore>) =>
  store.periods?.periods.map((period) => `${period.name} ${period.periodMonth}`)

describe('dashboard store', () => {
  it('loads the summary and the first page of months due together', async () => {
    const store = useDashboardStore()

    await store.refresh()

    expect(store.status).toBe('ready')
    expect(store.summary?.knownOutstanding).toBe(5750)
    expect(months(store)).toEqual(['Mohammed Yusuf 2026-08', 'Shaik Zahid Ali 2026-09'])
    expect(store.loadedAt).not.toBeNull()
  })

  it('is an error, never zeros, when the first load fails', async () => {
    vi.mocked(dashboardService.getRentalPeriods).mockRejectedValueOnce(
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
    fakeDashboard.summary = makeSummary({ knownOutstanding: 1 })
    vi.mocked(dashboardService.getRentalPeriods).mockRejectedValueOnce(
      new ApiError('network', 'offline'),
    )

    await store.refresh()

    // Not even the summary that did arrive: the screen never mixes two moments.
    expect(store.summary?.knownOutstanding).toBe(5750)
    expect(store.loadedAt).toBe(loadedAt)
    expect(store.status).toBe('ready')
    expect(store.refreshError).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    )
    expect(store.refreshing).toBe(false)

    await store.refresh()

    expect(store.refreshError).toBeNull()
    expect(store.summary?.knownOutstanding).toBe(1)
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

    store.setPreparation('not_prepared')
    await vi.waitFor(() => expect(store.periodsStatus).toBe('ready'))
    store.setTiming('all')
    await vi.waitFor(() => expect(store.periodsStatus).toBe('ready'))

    expect(store.page).toBe(1)
    expect(dashboardService.getRentalPeriods).toHaveBeenLastCalledWith(
      testProperty.id,
      { timing: 'all', preparation: 'not_prepared', month: null },
      1,
    )
    expect(months(store)).toEqual(['Mohammed Yusuf 2026-08', 'Mohammed Yusuf 2026-09'])
    expect(dashboardService.getSummary).toHaveBeenCalledTimes(1)
  })

  it('clears two filters in one reload, and ignores a change to the same filters', async () => {
    const store = useDashboardStore()
    await store.refresh()
    store.setFilters({ preparation: 'prepared', month: '2026-09' })
    await vi.waitFor(() => expect(store.periodsStatus).toBe('ready'))
    vi.mocked(dashboardService.getRentalPeriods).mockClear()

    store.setFilters({ preparation: 'all', month: null })
    store.setMonth(null)
    await vi.waitFor(() => expect(store.periodsStatus).toBe('ready'))

    expect(dashboardService.getRentalPeriods).toHaveBeenCalledTimes(1)
  })

  it('shows only the newest filter’s rows when responses arrive out of order', async () => {
    const store = useDashboardStore()
    await store.refresh()
    const slow = deferred<ReturnType<typeof periodPage>>()
    vi.mocked(dashboardService.getRentalPeriods).mockReturnValueOnce(slow.promise)

    store.setTiming('overdue')
    store.setTiming('upcoming')
    await vi.waitFor(() => expect(store.periodsStatus).toBe('ready'))
    slow.resolve(periodPage({ timing: 'overdue', preparation: 'all', month: null }))
    await Promise.resolve()

    expect(months(store)).toEqual(['Mohammed Yusuf 2026-09'])
  })

  it('reports a failed list reload apart, keeping the summary', async () => {
    const store = useDashboardStore()
    await store.refresh()
    vi.mocked(dashboardService.getRentalPeriods).mockRejectedValueOnce(
      new ApiError('unavailable', 'down'),
    )

    store.setTiming('overdue')
    await vi.waitFor(() => expect(store.periodsStatus).toBe('error'))

    expect(store.periodsError).toBe('Rent due is unavailable right now. Please try again shortly.')
    expect(store.summary?.knownOutstanding).toBe(5750)
  })

  it('marks a month not owed, then refreshes so it leaves the list', async () => {
    const store = useDashboardStore()
    await store.refresh()

    const saved = await store.markNotOwed('period-002', 'Settled in the old sheet')

    expect(saved).toBe(true)
    expect(dashboardService.markNotOwed).toHaveBeenCalledWith(
      testProperty.id,
      'period-002',
      'Settled in the old sheet',
    )
    expect(months(store)).toEqual(['Shaik Zahid Ali 2026-09'])
    expect(store.markingId).toBeNull()
  })

  it.each([
    [
      new ApiError('conflict', 'x', 'period_has_bill'),
      'This month has a bill. Void the bill first.',
    ],
    [new ApiError('forbidden', 'x'), "Only the property's owners can mark a month not owed."],
    [
      new ApiError('invalid-request', 'x', null, { reason: "Say why this month isn't owed." }),
      "Say why this month isn't owed.",
    ],
    [
      new ApiError('network', 'x'),
      "Couldn't reach the server. Check your connection and try again.",
    ],
  ])('says why a month couldn’t be marked not owed', async (error, message) => {
    vi.mocked(dashboardService.markNotOwed).mockRejectedValueOnce(error)
    const store = useDashboardStore()
    await store.refresh()

    expect(await store.markNotOwed('period-002', 'Waived')).toBe(false)

    expect(store.markError).toBe(message)
    expect(months(store)).toContain('Mohammed Yusuf 2026-08')
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
    expect(store.filters).toEqual({ timing: 'due', preparation: 'all', month: null })
  })
})
