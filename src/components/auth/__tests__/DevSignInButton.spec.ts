import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DevSignInButton from '@/components/auth/DevSignInButton.vue'

describe('DevSignInButton', () => {
  it('names the email it signs in as and emits signIn when clicked', async () => {
    const view = mount(DevSignInButton, { props: { email: 'dev-owner@example.test' } })

    await view.get('button').trigger('click')

    expect(view.get('button').text()).toBe('Dev sign-in as dev-owner@example.test')
    expect(view.emitted('signIn')).toHaveLength(1)
  })
})
