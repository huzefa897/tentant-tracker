import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import router from '@/router'

const user = { id: 'mock-user-1', phoneNumber: '+918341413827' }

function signIn() {
  localStorage.setItem('rent-tracker-auth-user', JSON.stringify(user))
}

function startOtpFlow() {
  sessionStorage.setItem('rent-tracker-pending-phone', user.phoneNumber)
}

// The guards read the auth store, which restores itself from storage when created.
async function navigate(path: string) {
  setActivePinia(createPinia())
  await router.push(path)
  return router.currentRoute.value.name
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('route guards', () => {
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

    it('redirects the dashboard to login', async () => {
      expect(await navigate('/dashboard')).toBe('login')
    })

    it('redirects a new rent entry to login', async () => {
      expect(await navigate('/tenants/tenant-001/entries/new')).toBe('login')
    })

    it.each(['/tenants/tenant-001/entries', '/tenants/tenant-001/entries/entry-1'])(
      'redirects %s to login',
      async (path) => {
        expect(await navigate(path)).toBe('login')
      },
    )

    it('redirects verify to login without a pending number', async () => {
      expect(await navigate('/verify')).toBe('login')
    })

    it('allows verify mid OTP flow', async () => {
      startOtpFlow()

      expect(await navigate('/verify')).toBe('verify')
    })
  })

  describe('signed in', () => {
    beforeEach(signIn)

    it('allows the dashboard', async () => {
      expect(await navigate('/dashboard')).toBe('dashboard')
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
      startOtpFlow()

      expect(await navigate('/verify')).toBe('dashboard')
    })
  })
})
