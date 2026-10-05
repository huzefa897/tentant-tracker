import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { useTenantStore } from '@/stores/tenant'
import { signInAs } from '@/test/mocks/authService'

// For store and composable tests: sign in, select the test property (the default identity has
// one) and load its tenants from the fake service, as the dashboard would. Needs the auth,
// access and tenant service fakes (see src/test/mocks).
export async function loadTestTenants() {
  signInAs()
  await useAuthStore().init()
  await useAccessStore().load()
  await useTenantStore().loadTenants()
}
