import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RentalPeriodTable from '@/components/dashboard/RentalPeriodTable.vue'
import { makePeriod, makeUnbilledPeriod } from '@/test/mocks/dashboardService'
import type { RentalPeriodRow } from '@/types/dashboard'

function render(periods: RentalPeriodRow[]) {
  return mount(RentalPeriodTable, { props: { periods, asOfDate: '2026-10-15' } })
}

const cells = (row: ReturnType<ReturnType<typeof render>['get']>) =>
  row.findAll('th, td').map((cell) => cell.text())

describe('RentalPeriodTable', () => {
  it('shows a month awaiting its bill as due, with no amount', () => {
    const wrapper = render([makeUnbilledPeriod()])

    expect(cells(wrapper.get('[data-testid="period-row"]'))).toEqual([
      'Mohammed Yusuf, Flat 301',
      'August 2026',
      '20 Sept 2026',
      'Overdue 25 days',
      'Not prepared',
      'Awaiting calculation',
      'Prepare bill',
    ])
    expect(wrapper.text()).not.toContain('₹0')
  })

  it('shows a prepared month’s outstanding amount and its actions', () => {
    const wrapper = render([makePeriod({ tenancyStatus: 'ended' })])

    expect(cells(wrapper.get('[data-testid="period-row"]'))).toEqual([
      'Shaik Zahid Ali, Flat 202 · Ended tenancy',
      'September 2026',
      '11 Oct 2026',
      'Overdue 4 days',
      'Prepared',
      '₹5,750',
      'Record payment  View bill',
    ])
  })

  it('says when an upcoming or today’s month is due, and colours only late ones', () => {
    const wrapper = render([
      makePeriod({ id: 'a', timing: 'due_today', daysOverdue: 0, dueDate: '2026-10-15' }),
      makePeriod({ id: 'b', timing: 'upcoming', daysOverdue: 0, dueDate: '2026-10-18' }),
    ])
    const [today, soon] = wrapper.findAll('[data-testid="period-row"]')

    expect(cells(today!)[3]).toBe('Due today')
    expect(today!.findAll('td')[2]!.classes()).toContain('text-warning')
    expect(cells(soon!)[3]).toBe('Due in 3 days')
    expect(soon!.findAll('td')[2]!.classes()).toContain('text-muted-foreground')
  })

  it('offers only the actions it was given, and emits the month', async () => {
    const unbilled = makeUnbilledPeriod({ actions: ['prepare_bill', 'mark_not_owed'] })
    const billed = makePeriod()
    const readOnly = makePeriod({ id: 'c', actions: ['view_bill'] })
    const wrapper = render([unbilled, billed, readOnly])
    const button = (label: string) =>
      wrapper
        .findAll('[data-testid="period-row"] button')
        .filter((b) => b.attributes('aria-label')?.startsWith(label))

    await button('Prepare bill')[0]!.trigger('click')
    await button('Mark not owed')[0]!.trigger('click')
    await button('Record payment')[0]!.trigger('click')
    await button('View bill')[1]!.trigger('click')

    expect(button('Record payment')).toHaveLength(1)
    expect(button('Prepare bill')[0]!.attributes('aria-label')).toBe(
      'Prepare bill: August 2026 · Mohammed Yusuf · Flat 301',
    )
    expect(wrapper.emitted('prepare')).toEqual([[unbilled]])
    expect(wrapper.emitted('notOwed')).toEqual([[unbilled]])
    expect(wrapper.emitted('record')).toEqual([[billed]])
    expect(wrapper.emitted('view')).toEqual([[readOnly]])
  })

  it('lists the same months as cards on phones', () => {
    const wrapper = render([makeUnbilledPeriod(), makePeriod()])
    const cards = wrapper.findAll('[data-testid="period-card"]')

    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('Awaiting calculation')
    expect(cards[0]!.text()).toContain('20 Sept 2026 · Overdue 25 days')
    expect(cards[1]!.text()).toContain('₹5,750')
  })
})
