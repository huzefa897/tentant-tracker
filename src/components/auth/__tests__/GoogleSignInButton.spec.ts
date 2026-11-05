import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GoogleSignInButton from '@/components/auth/GoogleSignInButton.vue'

function mountButton(props: { loading?: boolean; error?: string | null } = {}) {
  return mount(GoogleSignInButton, { props: { loading: false, error: null, ...props } })
}

describe('GoogleSignInButton', () => {
  it('emits signIn when clicked', async () => {
    const view = mountButton()

    await view.get('button').trigger('click')

    expect(view.get('button').text()).toBe('Continue with Google')
    expect(view.emitted('signIn')).toHaveLength(1)
  })

  it('is busy and disabled while signing in', () => {
    const button = mountButton({ loading: true }).get('button')

    expect(button.text()).toBe('Signing in…')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
  })

  it('shows an error tied to the button', () => {
    const view = mountButton({ error: 'No connection.' })

    expect(view.get('[role="alert"]').text()).toBe('No connection.')
    expect(view.get('button').attributes('aria-describedby')).toBe('sign-in-error')
  })

  it('has no error region without an error', () => {
    const view = mountButton()

    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(view.get('button').attributes('aria-describedby')).toBeUndefined()
  })
})
