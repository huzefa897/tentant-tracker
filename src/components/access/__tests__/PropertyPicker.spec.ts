import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PropertyPicker from '@/components/access/PropertyPicker.vue'
import type { PropertyAccess } from '@/types/access'

const properties: PropertyAccess[] = [
  { id: 'tower', name: 'Test Towers', role: 'owner' },
  { id: 'annex', name: 'Annex', role: 'manager' },
]

function mountPicker(selectedPropertyId: string | null = null) {
  return mount(PropertyPicker, { props: { properties, selectedPropertyId } })
}

describe('PropertyPicker', () => {
  it('lists each property with the user’s role', () => {
    const buttons = mountPicker().findAll('button')

    expect(buttons.map((b) => b.text())).toEqual(['Test TowersOwner', 'AnnexManager'])
  })

  it('emits the chosen property', async () => {
    const picker = mountPicker()

    await picker.findAll('button')[1]!.trigger('click')

    expect(picker.emitted('select')).toEqual([['annex']])
  })

  it('marks the selected property', () => {
    const buttons = mountPicker('annex').findAll('button')

    expect(buttons[0]!.attributes('aria-current')).toBeUndefined()
    expect(buttons[1]!.attributes('aria-current')).toBe('true')
    expect(buttons[1]!.find('[aria-label="Selected"]').exists()).toBe(true)
  })
})
