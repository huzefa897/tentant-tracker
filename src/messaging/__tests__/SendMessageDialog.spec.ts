import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import SendMessageDialog from '@/messaging/components/SendMessageDialog.vue'

const body = new DOMWrapper(document.body)
let wrapper: ReturnType<typeof mount> | undefined

async function mountDialog(props: Record<string, unknown> = {}) {
  wrapper = mount(SendMessageDialog, {
    props: { open: true, kind: 'bill_reminder', ...props },
    slots: { default: '<p data-testid="summary">September</p>' },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('SendMessageDialog', () => {
  it("is worded for the message's kind, around what it's about", async () => {
    await mountDialog()
    const dialog = body.get('[role="dialog"]')

    expect(dialog.text()).toContain('Send SMS reminder')
    expect(dialog.text()).toContain('Text the tenant about this bill now.')
    expect(dialog.get('[data-testid="summary"]').text()).toBe('September')
  })

  it('emits send, and closes on cancel', async () => {
    const dialog = await mountDialog()
    await body.get('[role="dialog"] form').trigger('submit')
    const cancel = body.findAll('[role="dialog"] button').find((b) => b.text() === 'Cancel')!
    await cancel.trigger('click')

    expect(dialog.emitted('send')).toHaveLength(1)
    expect(dialog.emitted('update:open')).toEqual([[false]])
  })

  it('shows the error inline', async () => {
    await mountDialog({ error: 'Already sent today.' })

    expect(body.get('[role="dialog"] [role="alert"]').text()).toBe('Already sent today.')
  })
})
