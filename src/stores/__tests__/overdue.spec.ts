import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/services/apiError'
import { dashboardService } from '@/services/dashboard.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { OVERDUE_LOAD_ERROR_MESSAGE, useOverdueStore } from '@/stores/overdue'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { fakeDashboard, makeOverdueTenant, overdueBills } from '@/test/mocks/dashboardService'
import type { OverdueBills } from '@/types/dashboard'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const names = (store: ReturnType<typeof useOverdueStore>) =>
  store.bills?.tenants.map((tenant) => tenant.name)

beforeEach(async () => {
  setActivePinia(createPinia())
  resetAuthService()
  resetAccessService()
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
})

describe('overdue store', () => {
  it('loads every overdue bill, grouped by tenant', async () => {
    const store = useOverdueStore()

    await store.refresh()

    expect(store.status).toBe('ready')
    expect(names(store)).toEqual(['Mohammed Yusuf', 'Shaik Zahid Ali'])
    expect(store.bills?.totalOutstanding).toBe(37250)
    expect(store.loadedAt).not.toBeNull()
    expect(store.filtered).toBe(false)
  })

  it('is an error, never an empty list, when the first load fails', async () => {
    vi.mocked(dashboardService.getOverdueBills).mockRejectedValueOnce(new ApiError('unknown', 'x'))
    const store = useOverdueStore()

    await store.refresh()

    expect(store.status).toBe('error')
    expect(store.error).toBe(OVERDUE_LOAD_ERROR_MESSAGE)
    expect(store.bills).toBeNull()
    expect(store.loaded).toBe(false)
  })

  it('keeps the list, and when it was loaded, when a refresh fails', async () => {
    const store = useOverdueStore()
    await store.refresh()
    const loadedAt = store.loadedAt
    vi.mocked(dashboardService.getOverdueBills).mockRejectedValueOnce(
      new ApiError('unavailable', 'down'),
    )

    await store.refresh()

    expect(names(store)).toHaveLength(2)
    expect(store.loadedAt).toBe(loadedAt)
    expect(store.refreshError).toBe(
      'Overdue bills are unavailable right now. Please try again shortly.',
    )
    expect(store.listStatus).toBe('ready')
  })

  it('never sends a second refresh while one is running', async () => {
    const pending = deferred<OverdueBills>()
    vi.mocked(dashboardService.getOverdueBills).mockReturnValueOnce(pending.promise)
    const store = useOverdueStore()

    const first = store.refresh()
    const second = store.refresh()
    pending.resolve(overdueBills())
    await Promise.all([first, second])

    expect(dashboardService.getOverdueBills).toHaveBeenCalledTimes(1)
    expect(store.refreshing).toBe(false)
  })

  it('reloads for new filters, and clears them back to the full list', async () => {
    const store = useOverdueStore()
    await store.refresh()

    await store.setFilters({ search: 'yusuf' })
    expect(names(store)).toEqual(['Mohammed Yusuf'])
    expect(store.filtered).toBe(true)

    await store.setFilters({ search: ' yusuf ' })
    expect(dashboardService.getOverdueBills).toHaveBeenCalledTimes(2)

    await store.clearFilters()
    expect(dashboardService.getOverdueBills).toHaveBeenLastCalledWith({
      propertyId: null,
      month: null,
      search: '',
    })
    expect(names(store)).toHaveLength(2)
    expect(store.filtered).toBe(false)
  })

  it('never shows the old filters’ list as the new one’s when it fails', async () => {
    const store = useOverdueStore()
    await store.refresh()
    vi.mocked(dashboardService.getOverdueBills).mockRejectedValueOnce(
      new ApiError('network', 'offline'),
    )

    await store.setFilters({ month: '2026-08' })

    expect(store.listStatus).toBe('error')
    expect(store.listError).toBe("Couldn't reach the server. Check your connection and try again.")
    expect(store.refreshError).toBeNull()

    await store.refresh()

    expect(store.listStatus).toBe('ready')
    expect(names(store)).toEqual(['Mohammed Yusuf'])
  })

  it('shows only the newest filters’ list when responses arrive out of order', async () => {
    const store = useOverdueStore()
    await store.refresh()
    const slow = deferred<OverdueBills>()
    vi.mocked(dashboardService.getOverdueBills).mockReturnValueOnce(slow.promise)

    const first = store.setFilters({ search: 'yusuf' })
    await store.setFilters({ search: 'zahid' })
    slow.resolve(overdueBills({ propertyId: null, month: null, search: 'yusuf' }))
    await first

    expect(names(store)).toEqual(['Shaik Zahid Ali'])
  })

  it('forgets everything on sign-out, but not on another property', async () => {
    fakeDashboard.overdueTenants = [makeOverdueTenant()]
    const store = useOverdueStore()
    await store.refresh()
    await store.setFilters({ month: '2026-09' })

    useAccessStore().clear()

    expect(store.bills).toBeNull()
    expect(store.status).toBe('idle')
    expect(store.filters).toEqual({ propertyId: null, month: null, search: '' })
  })
})
