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

  it('defaults to India', () => {
    const wrapper = mountForm()

    expect((wrapper.get('#phone-country').element as HTMLSelectElement).value).toBe('IN')
    expect(wrapper.text()).toContain('+91')
    expect(wrapper.find('[data-flag="IN"]').exists()).toBe(true)
  })

  it('offers India, Australia and the United States', () => {
    const wrapper = mountForm()

    expect(wrapper.findAll('#phone-country option').map((option) => option.text())).toEqual([
      'India (+91)',
      'Australia (+61)',
      'United States (+1)',
    ])
  })

  it.each([
    ['AU', '0412 345 678', '412 345 678', '+61412345678'],
    ['US', '(201) 555-0123', '201 555 0123', '+12015550123'],
  ])('formats and emits a %s number after switching country', async (code, typed, shown, e164) => {
    const wrapper = mountForm()

    await wrapper.get('#phone-country').setValue(code)
    expect(wrapper.find(`[data-flag="${code}"]`).exists()).toBe(true)

    const input = wrapper.get('#phone')
    await input.setValue(typed)
    expect((input.element as HTMLInputElement).value).toBe(shown)

    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([[e164]])
  })

  it('validates against the selected country', async () => {
    const wrapper = mountForm()
    const button = wrapper.get('button[type="submit"]')

    // Valid Indian number, but not an Australian mobile (no leading 4) once switched.
    await wrapper.get('#phone').setValue('8341413827')
    expect(button.attributes('disabled')).toBeUndefined()

    await wrapper.get('#phone-country').setValue('AU')
    expect((wrapper.get('#phone').element as HTMLInputElement).value).toBe('834 141 382')
    expect(button.attributes('disabled')).toBeDefined()
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
