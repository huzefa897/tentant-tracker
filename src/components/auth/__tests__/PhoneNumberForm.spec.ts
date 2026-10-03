import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PhoneNumberForm from '@/components/auth/PhoneNumberForm.vue'

function mountForm(props: { loading?: boolean; error?: string | null } = {}) {
  return mount(PhoneNumberForm, {
    props: { loading: false, error: null, ...props },
  })
}

describe('PhoneNumberForm', () => {
  it('formats typed digits as "XXXXX XXXXX"', async () => {
    const wrapper = mountForm()
    const input = wrapper.get('#phone')

    await input.setValue('8341413827')

    expect((input.element as HTMLInputElement).value).toBe('83414 13827')
  })

  it('strips non-digits and caps input at 10 digits', async () => {
    const wrapper = mountForm()
    const input = wrapper.get('#phone')

    await input.setValue('+91-83414abc138279999')

    expect((input.element as HTMLInputElement).value).toBe('91834 14138')
  })

  it('disables Continue until the number is valid', async () => {
    const wrapper = mountForm()
    const button = wrapper.get('button[type="submit"]')

    expect(button.attributes('disabled')).toBeDefined()

    await wrapper.get('#phone').setValue('5341413827')
    expect(button.attributes('disabled')).toBeDefined()

    await wrapper.get('#phone').setValue('8341413827')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('emits the number in E.164 on submit', async () => {
    const wrapper = mountForm()

    await wrapper.get('#phone').setValue('83414 13827')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([['+918341413827']])
  })

  it('does not emit for an invalid number', async () => {
    const wrapper = mountForm()

    await wrapper.get('#phone').setValue('12345')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('does not emit while loading', async () => {
    const wrapper = mountForm({ loading: true })

    await wrapper.get('#phone').setValue('8341413827')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('button[type="submit"]').text()).toBe('Sending code...')
  })

  it('shows the error inline and links it to the input', () => {
    const wrapper = mountForm({ error: 'Unable to send verification code. Please try again.' })

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('Unable to send verification code. Please try again.')
    expect(wrapper.get('#phone').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#phone').attributes('aria-describedby')).toBe(alert.attributes('id'))
  })
})
