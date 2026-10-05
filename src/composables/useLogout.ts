import { useRouter } from 'vue-router'

import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { useTenantStore } from '@/stores/tenant'

// Signs out of Firebase and clears per-user state (selected tenant and property access).
// Saved rent entries are kept: they're not per user yet (see CLAUDE.md).
export function useLogout() {
  const authStore = useAuthStore()
  const accessStore = useAccessStore()
  const tenantStore = useTenantStore()
  const router = useRouter()

  return async function logout() {
    tenantStore.clearSelectedTenant()
    accessStore.clear()
    await authStore.logout()
    await router.replace({ name: 'login' })
  }
}
