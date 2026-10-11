import { DOMWrapper, flushPromises } from '@vue/test-utils'

// Opens the account menu (AppLayout's UserMenu). Reka's trigger opens on Enter (its
// pointerdown handler can't be faked in jsdom), and the items render in a portal on document.body. Mount with attachTo.
export async function openUserMenu() {
  const trigger = new DOMWrapper(document.body).get('[data-testid="user-menu-trigger"]')
  await trigger.trigger('keydown', { key: 'Enter' })
  await flushPromises()
}
