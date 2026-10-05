import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessService } from '@/services/access.service'
import { ApiError, type ApiErrorKind } from '@/services/apiError'
import { authService } from '@/services/auth.service'
import { NOT_REGISTERED_MESSAGE, useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import type { AuthUser } from '@/types/auth'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))

const annex = {
  id: '6f1c2a4e-0000-4000-8000-000000000002',
  name: 'Annex',
  role: 'manager' as const,
}

async function signedInStore() {
  signInAs()
  await useAuthStore().init()
  return useAccessStore()
}

beforeEach(() => {
  resetAuthService()
  resetAccessService()
  setActivePinia(createPinia())
})

describe('access store', () => {
  it('does nothing while signed out', async () => {
    await useAuthStore().init()
    const store = useAccessStore()

    await store.load()

    expect(accessService.getMe).not.toHaveBeenCalled()
    expect(store.status).toBe('idle')
  })

  it('loads the identity and selects the only property', async () => {
    const store = await signedInStore()

    await store.load()

    expect(store.status).toBe('ready')
    expect(store.identity).toEqual(identityWith([testProperty]))
    expect(store.selectedProperty).toEqual(testProperty)
  })

  it('leaves the choice to the user with several properties', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
    const store = await signedInStore()

    await store.load()

    expect(store.properties).toHaveLength(2)
    expect(store.selectedProperty).toBeNull()
  })

  it('is ready with no properties when access is not configured', async () => {
    vi.mocked(accessService.getMe).mockResolvedValue(identityWith([]))
    const store = await signedInStore()

    await store.load()

    expect(store.status).toBe('ready')
    expect(store.properties).toEqual([])
    expect(store.selectedProperty).toBeNull()
  })

  it('loads once for the same user, sharing an in-flight request', async () => {
    const store = await signedInStore()

    await Promise.all([store.load(), store.load()])
    await store.load()

    expect(accessService.getMe).toHaveBeenCalledTimes(1)
  })

  it('reloads for a different user', async () => {
    let notify: (user: AuthUser | null) => void = () => {}
    vi.mocked(authService.onAuthStateChanged).mockImplementation((listener) => {
      notify = listener
      listener({ id: 'first', phoneNumber: '+918341413827' })
      return () => {}
    })
    await useAuthStore().init()
    const store = useAccessStore()
    await store.load()

    notify({ id: 'second', phoneNumber: '+61412345678' })
    await store.load()

    expect(accessService.getMe).toHaveBeenCalledTimes(2)
  })

  it.each<[ApiErrorKind, string]>([
    ['unauthorized', "Your sign-in couldn't be verified. Log out and sign in again."],
    ['unavailable', "Sign-in couldn't be checked right now. Please try again shortly."],
    ['network', "Couldn't reach the server. Check your connection and try again."],
    ['invalid-response', 'Unable to load your property access. Please try again.'],
  ])('reports a %s failure as an error, never as no access', async (kind, message) => {
    vi.mocked(accessService.getMe).mockRejectedValue(new ApiError(kind))
    const store = await signedInStore()

    await store.load()

    expect(store.status).toBe('error')
    expect(store.error).toBe(message)
    expect(store.identity).toBeNull()
  })

  it('ends the session when the backend says the number is not registered', async () => {
    vi.mocked(accessService.getMe).mockRejectedValue(
      new ApiError('forbidden', 'forbidden', 'not_registered'),
    )
    const store = await signedInStore()

    await store.load()

    expect(authService.logout).toHaveBeenCalled()
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(useAuthStore().loginNotice).toBe(NOT_REGISTERED_MESSAGE)
    expect(store.status).toBe('idle')
    expect(store.identity).toBeNull()
  })

  it('treats other refusals as errors without signing out', async () => {
    vi.mocked(accessService.getMe).mockRejectedValue(new ApiError('forbidden'))
    const store = await signedInStore()

    await store.load()

    expect(authService.logout).not.toHaveBeenCalled()
    expect(store.status).toBe('error')
  })

  it('retries after an error', async () => {
    vi.mocked(accessService.getMe).mockRejectedValueOnce(new ApiError('network'))
    const store = await signedInStore()
    await store.load()

    await store.load()

    expect(store.status).toBe('ready')
    expect(store.error).toBeNull()
    expect(store.selectedProperty).toEqual(testProperty)
  })

  describe('selectProperty', () => {
    it('selects a property the user has', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
      const store = await signedInStore()
      await store.load()

      store.selectProperty(annex.id)

      expect(store.selectedProperty).toEqual(annex)
    })

    it('ignores a property the user does not have', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(identityWith([testProperty, annex]))
      const store = await signedInStore()
      await store.load()

      store.selectProperty('someone-elses-property')

      expect(store.selectedPropertyId).toBeNull()
    })
  })

  it('clear forgets the identity and selection', async () => {
    const store = await signedInStore()
    await store.load()

    store.clear()

    expect(store.status).toBe('idle')
    expect(store.identity).toBeNull()
    expect(store.selectedPropertyId).toBeNull()
  })
})
