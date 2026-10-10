import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ToggleSwitch from '@/components/common/ToggleSwitch.vue'

function mountSwitch(modelValue: boolean) {
  return mount(ToggleSwitch, { props: { id: 'example', modelValue } })
}

describe('ToggleSwitch', () => {
  it('is a switch with the given id, showing its state', () => {
    const off = mountSwitch(false).get('#example')
    expect(off.attributes('role')).toBe('switch')
    expect(off.attributes('aria-checked')).toBe('false')
    expect(off.get('.switch-thumb').attributes('data-state')).toBe('unchecked')

    const on = mountSwitch(true).get('#example')
    expect(on.attributes('aria-checked')).toBe('true')
    expect(on.get('.switch-thumb').attributes('data-state')).toBe('checked')
  })

  it('emits the new value when clicked', async () => {
    const wrapper = mountSwitch(true)

    await wrapper.get('#example').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })
})
