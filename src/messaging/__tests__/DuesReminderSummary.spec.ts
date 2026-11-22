import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DuesReminderSummary from '@/messaging/components/DuesReminderSummary.vue'
import { makePreview } from '@/messaging/testing/fakeMessagingService'
import type { PreviewState } from '@/messaging/useSendMessage'

const tenant = { name: 'Test Tenant', flatNumber: '202' }

function mountSummary(preview: PreviewState) {
  return mount(DuesReminderSummary, { props: { tenant, preview } })
}

describe('DuesReminderSummary', () => {
  it('lists every month owed, the billed total and the text', () => {
    const summary = mountSummary({ status: 'ready', value: makePreview() })

    expect(summary.text()).toContain('Test Tenant · Flat 202')
    const rows = summary
      .get('[data-testid="dues-months"]')
      .findAll('div')
      .map((row) => row.findAll('dt, dd').map((cell) => cell.text()))
    expect(rows).toEqual([
      ['August 2026', 'No bill yet'],
      ['September 2026', '₹15,750'],
      ['Outstanding on bills', '₹15,750'],
    ])
    expect(summary.get('[data-testid="dues-body"]').text()).toBe(makePreview().body)
  })

  it('shows a skeleton while it loads', () => {
    const summary = mountSummary({ status: 'loading' })

    expect(summary.get('[data-testid="dues-loading"]').text()).toBe(
      'Loading what the SMS would say…',
    )
    expect(summary.find('[data-testid="dues-months"]').exists()).toBe(false)
  })

  it('says why there is nothing to send, with a retry', async () => {
    const summary = mountSummary({ status: 'error', message: 'Nothing is owed.' })

    expect(summary.get('[role="alert"]').text()).toBe('Nothing is owed.')
    await summary.get('button').trigger('click')
    expect(summary.emitted('retry')).toHaveLength(1)
  })
})
