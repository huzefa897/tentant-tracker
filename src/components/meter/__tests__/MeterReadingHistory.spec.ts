import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MeterReadingHistory from '@/components/meter/MeterReadingHistory.vue'
import { makeReading } from '@/test/mocks/meterReadingService'

const billed = makeReading({
  reading: 2985,
  readOn: '2026-12-31',
  consumption: 109,
  billedBy: { id: 'dec', billingMonth: '2026-12' },
})
const unbilled = makeReading({ reading: 2876, readOn: '2026-11-30', consumption: 313 })
const voided = makeReading({
  reading: 2867,
  readOn: '2026-11-29',
  status: 'void',
  voided: { at: '2026-11-30T08:00:00Z', byName: 'Test Owner', reason: 'Digits swapped' },
})

describe('MeterReadingHistory', () => {
  it('lists each reading with its consumption and whether it was billed', () => {
    const wrapper = mount(MeterReadingHistory, {
      props: { readings: [billed, unbilled, voided], canEdit: true },
    })
    const rows = wrapper.findAll('[data-testid="meter-reading"]')

    expect(rows[0]!.text()).toContain('2,985')
    expect(rows[0]!.text()).toContain('109 units since the previous')
    expect(rows[0]!.get('[data-testid="reading-billed"]').text()).toBe(
      'Billed on the December 2026 bill',
    )
    expect(rows[1]!.get('[data-testid="reading-unbilled"]').text()).toBe('Not billed yet')
    expect(rows[2]!.get('[data-testid="reading-void"]').text()).toBe('VOID · Digits swapped')
  })

  it('offers Correct and Void on active readings only, emitting the reading', async () => {
    const wrapper = mount(MeterReadingHistory, {
      props: { readings: [unbilled, voided], canEdit: true },
    })

    expect(wrapper.findAll('button')).toHaveLength(2)
    await wrapper.get('[aria-label="Correct reading 2,876"]').trigger('click')
    await wrapper.get('[aria-label="Void reading 2,876"]').trigger('click')
    expect(wrapper.emitted('correct')).toEqual([[unbilled]])
    expect(wrapper.emitted('void')).toEqual([[unbilled]])
  })

  it('offers nothing without permission', () => {
    const wrapper = mount(MeterReadingHistory, { props: { readings: [unbilled], canEdit: false } })

    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('says when there are no readings yet', () => {
    const wrapper = mount(MeterReadingHistory, { props: { readings: [], canEdit: true } })

    expect(wrapper.text()).toContain('No readings yet.')
  })
})
