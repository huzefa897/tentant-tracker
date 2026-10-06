import { useRouter } from 'vue-router'

import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { useRentEntryStore } from '@/stores/rentEntry'
import { useTenantStore } from '@/stores/tenant'

// Signs out of Firebase and clears per-user state: property access, the selected tenant and
// the bills loaded from the backend.
export function useLogout() {
  const authStore = useAuthStore()
  const accessStore = useAccessStore()
  const tenantStore = useTenantStore()
  const rentEntryStore = useRentEntryStore()
  const router = useRouter()

  return async function logout() {
    tenantStore.reset()
    rentEntryStore.reset()
    accessStore.clear()
    await authStore.logout()
    await router.replace({ name: 'login' })
  }
}
