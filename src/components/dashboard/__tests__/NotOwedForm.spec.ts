import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NotOwedForm from '@/components/dashboard/NotOwedForm.vue'
import { makeUnbilledPeriod } from '@/test/mocks/dashboardService'

function render(props = {}) {
  return mount(NotOwedForm, { props: { period: makeUnbilledPeriod(), ...props } })
}

describe('NotOwedForm', () => {
  it('names the month and saves the trimmed reason', async () => {
    const wrapper = render()

    expect(wrapper.get('[data-testid="not-owed-period"]').text()).toBe(
      'TenantMohammed Yusuf · Flat 301MonthAugust 2026Was due20 Sept 2026',
    )
    await wrapper.get('textarea').setValue('  Paid in cash, in the old sheet  ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')).toEqual([['Paid in cash, in the old sheet']])
  })

  it('needs a reason', async () => {
    const wrapper = render()

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe("Say why this month isn't owed.")
  })

  it('shows a save error and holds still while saving', async () => {
    const wrapper = render({
      saving: true,
      saveError: 'This month has a bill. Void the bill first.',
    })

    expect(wrapper.text()).toContain('This month has a bill. Void the bill first.')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Saving…')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toBeUndefined()

    await wrapper.setProps({ saving: false })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Cancel')!
      .trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
