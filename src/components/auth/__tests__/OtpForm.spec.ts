import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import OtpForm from '@/components/auth/OtpForm.vue'

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function mountForm(props: { loading?: boolean; error?: string | null } = {}) {
  wrapper = mount(OtpForm, {
    props: { loading: false, error: null, ...props },
    attachTo: document.body,
  })
  return wrapper
}

function slots(form: VueWrapper) {
  return form.findAll('[data-slot="pin-input-slot"]')
}

// Type one digit per slot, as the user would.
async function typeCode(form: VueWrapper, code: string) {
  const inputs = slots(form)
  for (const [index, digit] of [...code].entries()) {
    await inputs[index]!.setValue(digit)
  }
  await flushPromises()
}

describe('OtpForm', () => {
  it('renders six slots', () => {
    expect(slots(mountForm())).toHaveLength(6)
  })

  it('disables Verify until all six digits are entered', async () => {
    const form = mountForm()
    const button = form.get('button[type="submit"]')

    await typeCode(form, '92463')
    expect(button.attributes('disabled')).toBeDefined()

    await typeCode(form, '924636')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('emits the code once all six digits are entered', async () => {
    const form = mountForm()

    await typeCode(form, '924636')

    expect(form.emitted('submit')?.[0]).toEqual(['924636'])
  })

  it('does not emit while loading', async () => {
    const form = mountForm({ loading: true })

    await form.get('form').trigger('submit')

    expect(form.emitted('submit')).toBeUndefined()
    expect(form.get('button[type="submit"]').text()).toBe('Verifying...')
  })

  it('shows the error inline and marks the slots invalid', () => {
    const form = mountForm({ error: 'Invalid verification code. Please try again.' })

    expect(form.get('[role="alert"]').text()).toBe('Invalid verification code. Please try again.')
    for (const slot of slots(form)) {
      expect(slot.attributes('aria-invalid')).toBe('true')
      expect(slot.attributes('aria-describedby')).toBe('otp-error')
    }
  })
})
