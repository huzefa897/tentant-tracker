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

  it('emits a code once, and again only after it changes', async () => {
    const form = mountForm()

    await typeCode(form, '924636')
    await typeCode(form, '924636')
    expect(form.emitted('submit')).toEqual([['924636']])

    await slots(form)[5]!.setValue('7')
    await flushPromises()
    expect(form.emitted('submit')).toEqual([['924636'], ['924637']])
  })

  it('verifies the same code again from the Verify button', async () => {
    const form = mountForm()

    await typeCode(form, '924636')
    await form.get('form').trigger('submit')

    expect(form.emitted('submit')).toEqual([['924636'], ['924636']])
  })

  it('offers the code from the SMS to the phone’s autofill', () => {
    for (const slot of slots(mountForm())) {
      expect(slot.attributes('autocomplete')).toBe('one-time-code')
    }
  })

  it('clears the code and focuses the first slot', async () => {
    const form = mountForm()
    const clear = form.get('[data-testid="clear-code"]')
    expect(clear.attributes('disabled')).toBeDefined()

    await typeCode(form, '924')
    expect(clear.attributes('disabled')).toBeUndefined()
    await clear.trigger('click')
    await flushPromises()

    expect(slots(form).map((slot) => (slot.element as HTMLInputElement).value)).toEqual(
      Array(6).fill(''),
    )
    expect(form.emitted('clear')).toHaveLength(1)
    expect(document.activeElement).toBe(slots(form)[0]!.element)
    expect(clear.attributes('disabled')).toBeDefined()
  })

  it('verifies a code typed again after clearing it', async () => {
    const form = mountForm()

    await typeCode(form, '924636')
    await form.get('[data-testid="clear-code"]').trigger('click')
    await typeCode(form, '924636')

    expect(form.emitted('submit')).toEqual([['924636'], ['924636']])
  })

  it('cannot clear while verifying', () => {
    expect(
      mountForm({ loading: true }).get('[data-testid="clear-code"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('does not emit while loading', async () => {
    const form = mountForm({ loading: true })

    await form.get('form').trigger('submit')

    expect(form.emitted('submit')).toBeUndefined()
    expect(form.get('button[type="submit"]').text()).toBe('Verifying…')
    expect(form.get('button[type="submit"]').find('svg.animate-spin').exists()).toBe(true)
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
