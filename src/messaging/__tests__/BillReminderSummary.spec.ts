import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BillReminderSummary from '@/messaging/components/BillReminderSummary.vue'

describe('BillReminderSummary', () => {
  it('shows who is texted about which bill', () => {
    const summary = mount(BillReminderSummary, {
      props: {
        tenant: { name: 'Test Tenant', flatNumber: '202' },
        entry: { billingMonth: '2026-09', outstanding: 12500 },
      },
    }).text()

    expect(summary).toContain('Test Tenant · Flat 202')
    expect(summary).toContain('September 2026')
    expect(summary).toContain('₹12,500')
  })
})
