import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SendMessageForm from '@/messaging/components/SendMessageForm.vue'

const note = 'They get an SMS now.'

function mountForm(props: { sending?: boolean; sendError?: string | null } = {}) {
  return mount(SendMessageForm, {
    props: { note, ...props },
    slots: { default: '<p data-testid="summary">About September</p>' },
  })
}

describe('SendMessageForm', () => {
  it('shows what it is about and what they will get', () => {
    const form = mountForm()
    expect(form.get('[data-testid="summary"]').text()).toBe('About September')
    expect(form.text()).toContain(note)
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
