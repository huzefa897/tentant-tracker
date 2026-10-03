import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentEntriesLoadError from '@/components/rent/RentEntriesLoadError.vue'

describe('RentEntriesLoadError', () => {
  it('shows the message as an alert', () => {
    const wrapper = mount(RentEntriesLoadError, {
      props: { message: 'Saved entries could not be loaded. Please retry.' },
    })

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Saved entries could not be loaded. Please retry.',
    )
  })

  it('emits retry', async () => {
    const wrapper = mount(RentEntriesLoadError, { props: { message: 'Failed' } })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
