import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import VoidReadingForm from '@/components/meter/VoidReadingForm.vue'
import { makeReading } from '@/test/mocks/meterReadingService'

const reading = makeReading({ reading: 2876, readOn: '2026-11-30' })

describe('VoidReadingForm', () => {
  it('names the reading and emits the reason, trimmed', async () => {
    const wrapper = mount(VoidReadingForm, { props: { reading } })

    expect(wrapper.get('[data-testid="void-reading"]').text()).toBe('2,876 read on 30 Nov 2026')
    await wrapper.get('#void-reading-reason').setValue(' Wrong tenant ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('void')).toEqual([['Wrong tenant']])
  })

  it('needs a reason', async () => {
    const wrapper = mount(VoidReadingForm, { props: { reading } })

    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('void')).toBeUndefined()
    expect(wrapper.get('#void-reading-reason-error').text()).toBe(
      'Say why this reading is being voided.',
    )
  })

  it('emits cancel', async () => {
    const wrapper = mount(VoidReadingForm, { props: { reading } })

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
