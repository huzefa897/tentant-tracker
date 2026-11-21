import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SendReminderForm from '@/components/messaging/SendReminderForm.vue'

const tenant = { name: 'Test Tenant', flatNumber: '202' }
const entry = { billingMonth: '2026-09', outstanding: 12500 }

function mountForm(props: { sending?: boolean; sendError?: string | null } = {}) {
  return mount(SendReminderForm, { props: { tenant, entry, ...props } })
}

describe('SendReminderForm', () => {
  it('shows who is texted about which bill', () => {
    const form = mountForm()
    const summary = form.get('[data-testid="reminder-bill"]').text()
    expect(summary).toContain('Test Tenant · Flat 202')
    expect(summary).toContain('September 2026')
    expect(summary).toContain('₹12,500')
    expect(form.find('[role="alert"]').exists()).toBe(false)
  })

  it('emits send when submitted, and cancel', async () => {
    const form = mountForm()
    await form.get('form').trigger('submit')
    const cancel = form.findAll('button').find((b) => b.text() === 'Cancel')!
    await cancel.trigger('click')

    expect(form.emitted('send')).toHaveLength(1)
    expect(form.emitted('cancel')).toHaveLength(1)
  })

  it('disables both buttons while sending', () => {
    const form = mountForm({ sending: true })
    const buttons = form.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['Sending…', 'Cancel'])
    expect(buttons.every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })

  it('shows an error inline', () => {
    const form = mountForm({ sendError: 'A reminder for this bill was already sent today.' })
    expect(form.get('[role="alert"]').text()).toBe(
      'A reminder for this bill was already sent today.',
    )
  })
})
