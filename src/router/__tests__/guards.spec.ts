import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { authService } from '@/services/auth.service'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs, testUser } from '@/test/mocks/authService'
import type { AuthUser } from '@/types/auth'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))

const annex = {
  id: '6f1c2a4e-0000-4000-8000-000000000002',
  name: 'Annex',
  role: 'manager' as const,
}

// A fresh pinia per navigation: the auth store waits for Firebase's restored session.
// force: the shared router may already be on this path from an earlier test.
async function navigate(path: string, beforeNavigate?: () => Promise<void> | void) {
  setActivePinia(createPinia())
  await beforeNavigate?.()
  await router.push({ path, force: true })
  return router.currentRoute.value.name
}

async function startOtpFlow() {
  await useAuthStore().sendOtp('+918341413827', document.createElement('div'))
}

beforeEach(() => {
  resetAuthService()
  resetAccessService()
})

describe('route guards', () => {
  it('waits for Firebase to restore the session before deciding', async () => {
    let restore: (user: AuthUser | null) => void = () => {}
    vi.mocked(authService.onAuthStateChanged).mockImplementation((listener) => {
      restore = listener
      return () => {}
    })
    setActivePinia(createPinia())

    let settled = false
    const navigation = router.push('/dashboard').then(() => (settled = true))
    await flushPromises()
    expect(settled).toBe(false)

    restore(testUser)
    await navigation

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  describe('signed out', () => {
    it('shows login', async () => {
      expect(await navigate('/login')).toBe('login')
    })

    it('redirects / to login', async () => {
      expect(await navigate('/')).toBe('login')
    })

    it('redirects unknown paths to login', async () => {
      expect(await navigate('/nope')).toBe('login')
    })

    it.each([
      '/dashboard',
      '/properties',
      '/tenants/tenant-001/entries/new',
      '/tenants/tenant-001/entries',
      '/tenants/tenant-001/entries/entry-1',
    ])('redirects %s to login', async (path) => {
      expect(await navigate(path)).toBe('login')
    })

    it('never asks the backend for access', async () => {
      await navigate('/dashboard')

      expect(accessService.getMe).not.toHaveBeenCalled()
    })

    it('redirects verify to login without a pending number', async () => {
      expect(await navigate('/verify')).toBe('login')
    })

    it('allows verify mid OTP flow', async () => {
      expect(await navigate('/verify', startOtpFlow)).toBe('verify')
    })
  })

  describe('signed in with one property', () => {
    beforeEach(() => signInAs())

    it('selects it and allows the dashboard', async () => {
      expect(await navigate('/dashboard')).toBe('dashboard')
      expect(useAccessStore().selectedProperty).toEqual(testProperty)
    })

    it('allows a new rent entry for a tenant', async () => {
      expect(await navigate('/tenants/tenant-001/entries/new')).toBe('rent-entry-new')
      expect(router.currentRoute.value.params.tenantId).toBe('tenant-001')
    })

    it('allows a tenant’s entry history', async () => {
      expect(await navigate('/tenants/tenant-001/entries')).toBe('rent-entry-history')
    })

    it('allows an entry’s details, keeping "new" for the new-entry page', async () => {
      expect(await navigate('/tenants/tenant-001/entries/entry-1')).toBe('rent-entry-details')
      expect(router.currentRoute.value.params).toEqual({
        tenantId: 'tenant-001',
        entryId: 'entry-1',
      })
      expect(await navigate('/tenants/tenant-001/entries/new')).toBe('rent-entry-new')
    })

    it('redirects login to the dashboard', async () => {
      expect(await navigate('/login')).toBe('dashboard')
    })

    it('redirects verify to the dashboard', async () => {
      expect(await navigate('/verify', startOtpFlow)).toBe('dashboard')
    })
  })

  describe('signed in without a selected property', () => {
    beforeEach(() => signInAs())

    it('sends a user with no access to the property page', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([]))

      expect(await navigate('/dashboard')).toBe('property-select')
    })

    it('asks a user with several properties to choose, remembering where they were going', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))

      expect(await navigate('/tenants/tenant-001/entries')).toBe('property-select')
      expect(router.currentRoute.value.query.redirect).toBe('/tenants/tenant-001/entries')
    })

    it('sends the user to the property page when access fails to load', async () => {
      vi.mocked(accessService.getMe).mockRejectedValue(new ApiError('unavailable'))

      expect(await navigate('/dashboard')).toBe('property-select')
      expect(useAccessStore().status).toBe('error')
    })
  })
})
