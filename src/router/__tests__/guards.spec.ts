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

    it('redirects login to the dashboard', async () => {
      expect(await navigate('/login')).toBe('dashboard')
    })

    it('redirects verify to the dashboard', async () => {
      startOtpFlow()

      expect(await navigate('/verify')).toBe('dashboard')
    })
  })
})
