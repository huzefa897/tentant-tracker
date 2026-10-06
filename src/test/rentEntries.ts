import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import { RouterView } from 'vue-router'

import router from '@/router'
import { signInAs } from '@/test/mocks/authService'

export { makeEntry, makePayment, makeReceipt } from '@/test/rentEntryFixtures'

// Signs in and opens the URL directly, as after a refresh: fresh Pinia, nothing selected.
// Rendered through RouterView, as in the app.
// `beforeMount` runs with the fresh Pinia active, e.g. to stub a store action.
// Signs in through the fake auth service: the calling test file must mock
// '@/services/auth.service' and '@/services/access.service' with '@/test/mocks/*' (and the
// tenant and rent entry services, for pages that load them).
export async function openPage(path: string, beforeMount?: () => void): Promise<VueWrapper> {
  signInAs()
  const pinia = createPinia()
  setActivePinia(pinia)
  beforeMount?.()
  await router.push(path)
  const wrapper = mount(() => h(RouterView), {
    global: { plugins: [pinia, router] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}
