import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { useAuthStore } from '@/stores/auth'
import type { AppIdentity } from '@/types/access'

export type AccessStatus = 'idle' | 'loading' | 'ready' | 'error'

export const NOT_REGISTERED_MESSAGE =
  "This number isn't registered. Contact the property owner to be added."

function messageFor(error: unknown): string {
  const kind = error instanceof ApiError ? error.kind : 'unknown'

  switch (kind) {
    case 'unauthorized':
      return "Your sign-in couldn't be verified. Log out and sign in again."
    case 'unavailable':
      return "Sign-in couldn't be checked right now. Please try again shortly."
    case 'network':
      return "Couldn't reach the server. Check your connection and try again."
    default:
      return 'Unable to load your property access. Please try again.'
  }
}

// What the backend says the signed-in user may access (GET /api/v1/me/), and which property
// is selected. Separate from tenant selection.
export const useAccessStore = defineStore('access', () => {
  const authStore = useAuthStore()

  const identity = ref<AppIdentity | null>(null)
  const status = ref<AccessStatus>('idle')
  const error = ref<string | null>(null)
  const selectedPropertyId = ref<string | null>(null)
  // The Firebase user the identity belongs to, so another account never sees stale access.
  const loadedForUserId = ref<string | null>(null)

  const properties = computed(() => identity.value?.properties ?? [])
  const selectedProperty = computed(
    () => properties.value.find((p) => p.id === selectedPropertyId.value) ?? null,
  )

  // The pending /me request and the account it's for. Never shared across accounts: a
  // response for an account that has since signed out is discarded.
  let inFlight: { userId: string; promise: Promise<void> } | null = null

  // Idempotent for the same user; doubles as Retry after an error.
  function load(): Promise<void> {
    const userId = authStore.user?.id ?? null
    if (!userId) return Promise.resolve()
    if (status.value === 'ready' && loadedForUserId.value === userId) return Promise.resolve()
    if (inFlight?.userId === userId) return inFlight.promise

    const request: { userId: string; promise: Promise<void> } = {
      userId,
      promise: Promise.resolve(),
    }
    // Registered before the request starts, so isCurrent() holds from the first line.
    inFlight = request
    const isCurrent = () => inFlight === request && authStore.user?.id === userId

    request.promise = (async () => {
      status.value = 'loading'
      error.value = null

      try {
        const result = await accessService.getMe()
        if (!isCurrent()) return

        identity.value = result
        loadedForUserId.value = userId
        status.value = 'ready'

        if (!result.properties.some((p) => p.id === selectedPropertyId.value)) {
          selectedPropertyId.value = null
        }
        // One property: select it. Several: the user picks.
        if (result.properties.length === 1) {
          selectedPropertyId.value = result.properties[0]!.id
        }
      } catch (err) {
        if (!isCurrent()) return

        // Firebase verified the number, but nobody added it: sign out and say why.
        if (err instanceof ApiError && err.code === 'not_registered') {
          clear()
          await authStore.endSession(NOT_REGISTERED_MESSAGE)
          return
        }

        identity.value = null
        loadedForUserId.value = null
        selectedPropertyId.value = null
        error.value = messageFor(err)
        status.value = 'error'
      } finally {
        if (inFlight === request) inFlight = null
      }
    })()

    return request.promise
  }

  function selectProperty(propertyId: string) {
    if (properties.value.some((p) => p.id === propertyId)) {
      selectedPropertyId.value = propertyId
    }
  }

  function clear() {
    // Any pending response is now for a previous session.
    inFlight = null
    identity.value = null
    status.value = 'idle'
    error.value = null
    selectedPropertyId.value = null
    loadedForUserId.value = null
  }

  return {
    identity,
    status,
    error,
    selectedPropertyId,
    properties,
    selectedProperty,
    load,
    selectProperty,
    clear,
  }
})
