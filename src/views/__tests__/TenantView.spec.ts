import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { accessService } from '@/services/access.service'
import { ApiError } from '@/services/apiError'
import { messagingService } from '@/messaging/messaging.service'
import { receiptService } from '@/services/receipt.service'
import { rentEntryService } from '@/services/rentEntry.service'
import { identityWith, resetAccessService, testProperty } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import {
  fakeMessaging,
  makePreview,
  resetMessagingService,
} from '@/messaging/testing/fakeMessagingService'
import { fakeReceipts } from '@/test/mocks/receiptService'
import { addFakePayment, fakeEntries, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { fakeTenancies, resetTenantService, testTenants } from '@/test/mocks/tenantService'
import { makeEntry, makePayment, openPage } from '@/test/rentEntries'
import { downloadReceiptPdf } from '@/utils/receiptDownload'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/payment.service', () => import('@/test/mocks/paymentService'))
vi.mock('@/services/receipt.service', () => import('@/test/mocks/receiptService'))
vi.mock('@/messaging/messaging.service', () => import('@/messaging/testing/fakeMessagingService'))
vi.mock('@/utils/receiptDownload', () => ({ downloadReceiptPdf: vi.fn() }))

let view: VueWrapper | undefined

async function openTenant(tenantId = 'tenant-001') {
  view = await openPage(`/tenants/${tenantId}`)
  return view
}

function button(label: string) {
  const match = view!.findAll('button').find((b) => b.text().startsWith(label))
  if (!match) throw new Error(`No "${label}" button`)
  return match
}

function saveEntries(...months: string[]) {
  fakeEntries.entries = months.map((billingMonth, index) =>
    makeEntry({ id: `entry-${index}`, billingMonth }),
  )
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
  resetRentEntryService()
  resetMessagingService()
  // Off unless a test turns it on, so Send SMS shows only where a test expects it.
  fakeMessaging.status = { enabled: false, ready: true, canSend: true }
})

afterEach(() => {
  view?.unmount()
  view = undefined
  vi.useRealTimers()
})

describe('TenantView', () => {
  it('shows the tenant’s details under the property', async () => {
    await openTenant()

    expect(view!.get('[data-testid="selected-property"]').text()).toBe('Test Towers')
    expect(view!.get('h1').text()).toBe('Tenant overview')
    expect(view!.get('#tenant-name').text()).toBe('Shaik Zahid Ali')
  })

  it('opens a new bill, the bills and the meter', async () => {
    fakeTenancies.tenants = testTenants.map((tenant) =>
      tenant.id === 'tenant-002'
        ? { ...tenant, meterBaseline: { reading: 2400, readOn: '2026-09-01' } }
        : tenant,
    )
    await openTenant('tenant-002')

    await button('New bill').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-new'))
    expect(router.currentRoute.value.params.tenantId).toBe('tenant-002')

    view!.unmount()
    await openTenant('tenant-002')
    await button('Bills').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))

    view!.unmount()
    await openTenant('tenant-002')
    await button('Meter readings').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('meter-readings'))
  })

  it('shows Tenant not found for an unknown tenant, with the way to Tenants', async () => {
    await openTenant('tenant-999')

    expect(view!.get('[role="alert"]').text()).toContain('Tenant not found')

    await button('Go to tenants').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('tenants'))
  })

  describe('their bills', () => {
    it('shows the bill count from the API', async () => {
      saveEntries('2026-08', '2026-09')
      await openTenant()

      expect(rentEntryService.getEntries).toHaveBeenCalledWith(expect.any(String), 'tenant-001')
      expect(button('Bills').text()).toBe('Bills (2)')
    })

    it('shows a skeleton, not a count or latest bill, on error, then auto-retries', async () => {
      vi.useFakeTimers()
      saveEntries('2026-09')
      vi.mocked(rentEntryService.getEntries).mockRejectedValueOnce(new ApiError('unknown'))
      await openTenant()

      expect(button('Bills').text()).toBe('Bills')
      expect(view!.find('[data-testid="latest-entry-loading"]').exists()).toBe(true)

      vi.advanceTimersByTime(5000)
      await flushPromises()

      expect(button('Bills').text()).toBe('Bills (1)')
      expect(view!.find('[data-testid="latest-entry-loading"]').exists()).toBe(false)
    })

    it('shows the latest bill below the name and opens it', async () => {
      fakeEntries.entries = [
        makeEntry({ id: 'entry-aug', billingMonth: '2026-08' }),
        makeEntry({ id: 'entry-oct', billingMonth: '2026-10', waterAmount: 0 }),
        makeEntry({ id: 'entry-sep', billingMonth: '2026-09' }),
      ]
      await openTenant()

      const card = view!.get('[aria-labelledby="latest-entry-heading"]')
      expect(card.get('h3').text()).toBe('October 2026')
      expect(card.text()).toContain('₹15,450')
      expect(card.text()).toContain('Unpaid')

      await card.get('button').trigger('click')
      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
      expect(router.currentRoute.value.params).toEqual({
        tenantId: 'tenant-001',
        entryId: 'entry-oct',
      })
      expect(router.currentRoute.value.query).toEqual({})
    })

    it('holds the latest bill’s place with a skeleton while bills load', async () => {
      vi.mocked(rentEntryService.getEntries).mockReturnValueOnce(new Promise(() => {}))
      await openTenant()

      expect(view!.get('[data-testid="latest-entry-loading"]').text()).toBe(
        'Loading the latest bill…',
      )
      expect(view!.find('[aria-labelledby="latest-entry-heading"]').exists()).toBe(false)
    })

    it('shows no latest bill for a tenant without bills', async () => {
      saveEntries('2026-09')
      await openTenant('tenant-002')

      expect(view!.find('[aria-labelledby="latest-entry-heading"]').exists()).toBe(false)
      expect(button('Bills').text()).toBe('Bills (0)')
    })

    it('reloads the latest bill each time the page opens', async () => {
      await openTenant()
      expect(view!.find('[aria-labelledby="latest-entry-heading"]').exists()).toBe(false)

      // Saved elsewhere (e.g. the new bill page) while away.
      saveEntries('2026-10')
      await router.push('/tenants')
      await router.push('/tenants/tenant-001')
      await flushPromises()

      expect(view!.get('[aria-labelledby="latest-entry-heading"] h3').text()).toBe('October 2026')
    })
  })

  describe('the latest bill’s receipt', () => {
    beforeEach(async () => {
      vi.mocked(downloadReceiptPdf).mockReset().mockResolvedValue()
      fakeEntries.entries = [makeEntry({ id: 'entry-oct', billingMonth: '2026-10' })]
      addFakePayment(makePayment({ id: 'p-1', entryId: 'entry-oct', paidDate: '2026-10-03' }))
      addFakePayment(
        makePayment({ id: 'p-2', entryId: 'entry-oct', amount: 2000, paidDate: '2026-10-05' }),
      )
      await openTenant()
    })

    function receiptButton() {
      return view!.get('[data-testid="download-entry-receipt"]')
    }

    it('downloads the receipt for the bill’s most recent payment', async () => {
      await receiptButton().trigger('click')
      await flushPromises()

      expect(receiptService.issueReceipt).toHaveBeenCalledWith(
        expect.any(String),
        'tenant-001',
        'entry-oct',
        'p-2',
      )
      expect(downloadReceiptPdf).toHaveBeenCalledWith(fakeReceipts.get('p-2'))
      expect(view!.find('[data-testid="receipt-error"]').exists()).toBe(false)
    })

    it('shows why a receipt can’t be issued', async () => {
      vi.mocked(receiptService.issueReceipt).mockRejectedValueOnce(
        new ApiError('invalid-request', 'x', 'receipt_configuration_incomplete', {
          detail: 'Configure the property address before issuing receipts.',
        }),
      )

      await receiptButton().trigger('click')
      await flushPromises()

      expect(view!.get('[data-testid="receipt-error"]').text()).toBe(
        'Configure the property address before issuing receipts.',
      )
      expect(downloadReceiptPdf).not.toHaveBeenCalled()
    })
  })

  describe('sending an SMS about what they owe', () => {
    const body = new DOMWrapper(document.body)
    const sendApi = vi.mocked(messagingService.sendMessage)
    const DUES = { kind: 'dues_reminder' } as const

    function dialog() {
      return body.get('[role="dialog"]')
    }

    async function openDialog() {
      await view!.get('[data-testid="send-message"]').trigger('click')
      await flushPromises()
    }

    async function sendFromDialog() {
      await openDialog()
      await dialog().get('form').trigger('submit')
      await flushPromises()
    }

    beforeEach(() => {
      fakeMessaging.status = { enabled: true, ready: true, canSend: true }
    })

    it('offers Send SMS among the tenant’s actions where messaging is on', async () => {
      await openTenant()

      expect(view!.get('[data-testid="send-message"]').text()).toBe('Send SMS')
      expect(
        view!
          .find('[aria-labelledby="latest-entry-heading"] [data-testid="send-message"]')
          .exists(),
      ).toBe(false)
    })

    it('offers it to a manager', async () => {
      vi.mocked(accessService.getMe).mockResolvedValue(
        identityWith([{ ...testProperty, role: 'manager' }]),
      )
      await openTenant()

      expect(view!.find('[data-testid="send-message"]').exists()).toBe(true)
    })

    it.each([
      ['messaging is off', { enabled: false, ready: true, canSend: true }],
      ['SMS is not set up', { enabled: true, ready: false, canSend: true }],
      ['the role may not send', { enabled: true, ready: true, canSend: false }],
    ])('hides it when %s', async (_, status) => {
      fakeMessaging.status = status
      await openTenant()

      expect(view!.find('[data-testid="send-message"]').exists()).toBe(false)
    })

    it('says so, with a retry, when it cannot tell whether SMS is offered', async () => {
      vi.mocked(messagingService.getPropertyMessaging).mockRejectedValueOnce(
        new ApiError('network', 'down'),
      )
      await openTenant()

      const error = view!.get('[data-testid="reminder-status-error"]')
      expect(error.get('[role="alert"]').text()).toContain(
        "Couldn't check whether an SMS can be sent",
      )
      expect(view!.find('[data-testid="send-message"]').exists()).toBe(false)

      await error.get('button').trigger('click')
      await flushPromises()

      expect(view!.find('[data-testid="reminder-status-error"]').exists()).toBe(false)
      expect(view!.find('[data-testid="send-message"]').exists()).toBe(true)
    })

    it('previews every month owed and the text, sending nothing until confirmed', async () => {
      await openTenant()
      await openDialog()

      expect(messagingService.previewMessage).toHaveBeenCalledWith(
        testProperty.id,
        'tenant-001',
        DUES,
      )
      expect(dialog().text()).toContain('Send SMS reminder')
      const months = dialog().get('[data-testid="dues-months"]').text()
      expect(months).toContain('August 2026')
      expect(months).toContain('No bill yet')
      expect(months).toContain('September 2026')
      expect(months).toContain('₹15,750')
      expect(dialog().get('[data-testid="dues-body"]').text()).toBe(makePreview().body)
      expect(sendApi).not.toHaveBeenCalled()
    })

    it('sends on Send, closes and says so', async () => {
      await openTenant()
      await sendFromDialog()

      expect(sendApi).toHaveBeenCalledWith(testProperty.id, 'tenant-001', DUES)
      expect(body.find('[role="dialog"]').exists()).toBe(false)
      expect(view!.get('[role="status"]').text()).toMatch(/^SMS reminder sent to .+\.$/)
    })

    it('sends nothing on Cancel', async () => {
      await openTenant()
      await openDialog()

      const cancel = dialog()
        .findAll('button')
        .find((b) => b.text() === 'Cancel')!
      await cancel.trigger('click')
      await flushPromises()

      expect(body.find('[role="dialog"]').exists()).toBe(false)
      expect(sendApi).not.toHaveBeenCalled()
    })

    it('holds Send back while the preview loads', async () => {
      vi.mocked(messagingService.previewMessage).mockReturnValueOnce(new Promise(() => {}))
      await openTenant()
      await openDialog()

      expect(dialog().find('[data-testid="dues-loading"]').exists()).toBe(true)
      const send = dialog()
        .findAll('button')
        .find((b) => b.text() === 'Send SMS')!
      expect(send.attributes('disabled')).toBeDefined()
      await dialog().get('form').trigger('submit')
      expect(sendApi).not.toHaveBeenCalled()
    })

    it('says when nothing is owed, and offers no Send', async () => {
      fakeMessaging.preview = null
      await openTenant()
      await openDialog()

      expect(dialog().get('[data-testid="dues-error"] [role="alert"]').text()).toBe(
        "Nothing is owed: there's no month to remind about.",
      )
      const send = dialog()
        .findAll('button')
        .find((b) => b.text() === 'Send SMS')!
      expect(send.attributes('disabled')).toBeDefined()
    })

    it('says a second one today was refused, and keeps the dialog open', async () => {
      fakeMessaging.sent = ['dues']
      await openTenant()
      await sendFromDialog()

      expect(dialog().get('form > [role="alert"]').text()).toBe(
        'A reminder for these months was already sent today.',
      )
    })

    it('shows why the provider refused it, to try again', async () => {
      fakeMessaging.outcome = { outcome: 'failed', reason: 'The provider refused the message.' }
      await openTenant()
      await sendFromDialog()

      expect(dialog().get('form > [role="alert"]').text()).toBe(
        "The SMS wasn't sent: The provider refused the message. Try again.",
      )
    })

    it('stays on the page while it sends, then shows the answer', async () => {
      let answer!: () => void
      sendApi.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => (answer = resolve))
        return { outcome: 'sent', reason: '' }
      })
      await openTenant()
      await sendFromDialog()

      await router.push('/tenants/tenant-002')
      await router.push('/tenants')
      await flushPromises()
      expect(router.currentRoute.value.params).toEqual({ tenantId: 'tenant-001' })
      expect(body.find('[role="dialog"]').exists()).toBe(true)

      answer()
      await flushPromises()
      expect(body.find('[role="dialog"]').exists()).toBe(false)
      expect(view!.get('[role="status"]').text()).toMatch(/^SMS reminder sent to .+\.$/)

      await router.push('/tenants')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('tenants')
    })

    it('says an unconfirmed one may have gone', async () => {
      fakeMessaging.outcome = { outcome: 'unknown', reason: 'No answer.' }
      await openTenant()
      await sendFromDialog()

      expect(body.find('[role="dialog"]').exists()).toBe(false)
      expect(view!.get('[role="status"]').text()).toBe(
        "The SMS may not have gone out: it wasn't confirmed. It won't be sent again today.",
      )
    })
  })
})
