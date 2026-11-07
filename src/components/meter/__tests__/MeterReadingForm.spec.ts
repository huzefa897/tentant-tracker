import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MeterReadingForm from '@/components/meter/MeterReadingForm.vue'
import { makeReading } from '@/test/mocks/meterReadingService'

const after = { reading: 2563, readOn: '2026-10-31' }

function mountForm(props: Partial<InstanceType<typeof MeterReadingForm>['$props']> = {}) {
  return mount(MeterReadingForm, { attachTo: document.body, props: { after, ...props } })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 5, 12))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MeterReadingForm', () => {
  it('shows the previous reading and the units since it as the reading is typed', async () => {
    const wrapper = mountForm()

    expect(wrapper.get('[data-testid="meter-after"]').text()).toBe(
      'Previous reading 2,563 on 31 Oct 2026',
    )
    await wrapper.get('#meter-reading').setValue('2876')
    expect(wrapper.get('[data-testid="meter-consumption"]').text()).toBe(
      '313 units since the previous reading',
    )
    wrapper.unmount()
  })

  it('emits the reading, dated today unless changed', async () => {
    const wrapper = mountForm()

    await wrapper.get('#meter-reading').setValue('2876.5')
    await wrapper.get('#meter-notes').setValue(' Kitchen meter ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([
      [{ reading: 2876.5, readOn: '2026-11-05', notes: 'Kitchen meter' }],
    ])
    wrapper.unmount()
  })

  it('refuses a reading below the previous one, inline', async () => {
    const wrapper = mountForm()

    await wrapper.get('#meter-reading').setValue('2500')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('#meter-reading-error').text()).toBe("The reading can't be below 2,563.")
    expect(document.activeElement?.id).toBe('meter-reading')
    wrapper.unmount()
  })

  it('refuses an empty reading', async () => {
    const wrapper = mountForm()

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('#meter-reading-error').text()).toBe('Enter the meter reading.')
    wrapper.unmount()
  })

  it('starts a correction from the reading and needs a reason', async () => {
    const wrong = makeReading({ reading: 2867, readOn: '2026-11-01' })
    const wrapper = mountForm({ correcting: wrong })

    expect((wrapper.get('#meter-reading').element as HTMLInputElement).value).toBe('2867')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('#meter-reason-error').text()).toBe(
      'Say why this reading is being corrected.',
    )

    await wrapper.get('#meter-reading').setValue('2876')
    await wrapper.get('#meter-reason').setValue('Digits swapped')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([
      [{ reading: 2876, readOn: '2026-11-01', notes: '', reason: 'Digits swapped' }],
    ])
    expect(wrapper.text()).toContain('Correct reading')
    wrapper.unmount()
  })

  it('shows the save error and disables itself while saving', () => {
    const wrapper = mountForm({ saving: true, saveError: 'There’s already a reading on that day.' })

    expect(wrapper.get('[role="alert"]').text()).toBe('There’s already a reading on that day.')
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Saving…')
    wrapper.unmount()
  })
})
