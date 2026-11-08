import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import QuickEntryDialog from '@/components/nav/QuickEntryDialog.vue'
import { testTenants } from '@/test/mocks/tenantService'
import type { QuickEntryStep, RecordKind } from '@/types/nav'

const body = new DOMWrapper(document.body)
let dialog: VueWrapper | undefined

// tenant-002 has a meter; the others don't.
const tenants = testTenants.map((tenant) =>
  tenant.id === 'tenant-002'
    ? { ...tenant, meterBaseline: { reading: 2400, readOn: '2026-09-01' } }
    : tenant,
)

async function openDialog(props: Record<string, unknown> = {}) {
  dialog = mount(QuickEntryDialog, {
    props: { open: true, step: 'kind', kind: null, tenants, query: '', status: 'ready', ...props },
    attachTo: document.body,
  })
  await flushPromises()
  return dialog
}

async function atStep(step: QuickEntryStep, kind: RecordKind | null, props = {}) {
  await dialog!.setProps({ step, kind, ...props })
  await flushPromises()
}

async function chooseTenant(index: number) {
  await body.get('button[aria-label="Select tenant"]').trigger('click')
  await flushPromises()
  await body.findAll('[role="option"]')[index]!.trigger('click')
  await flushPromises()
}

const monthStep = { step: 'month', kind: 'bill', billTenant: tenants[0] }

afterEach(() => {
  dialog?.unmount()
  dialog = undefined
})

describe('QuickEntryDialog', () => {
  it('asks what to record: a bill, a payment or a meter reading', async () => {
    await openDialog()

    expect(body.get('[role="dialog"]').text()).toContain('What would you like to record?')
    expect(body.find('[data-testid="quick-bill"]').text()).toContain('New bill')
    expect(body.find('[data-testid="quick-payment"]').text()).toContain('Payment')
    expect(body.find('[data-testid="quick-reading"]').text()).toContain('Meter reading')
  })

  it('reports the kind chosen', async () => {
    await openDialog()

    await body.get('[data-testid="quick-payment"]').trigger('click')

    expect(dialog!.emitted('choose-kind')).toEqual([['payment']])
  })

  it('asks for the tenant once a kind is chosen', async () => {
    await openDialog({ step: 'tenant', kind: 'bill' })

    expect(body.get('[role="dialog"]').text()).toContain('Choose the tenant.')
    await chooseTenant(0)

    expect(dialog!.emitted('choose-tenant')).toEqual([['bill', 'tenant-001']])
  })

  it('records a payment for the tenant chosen', async () => {
    await openDialog({ step: 'tenant', kind: 'payment' })

    await chooseTenant(1)

    expect(dialog!.emitted('choose-tenant')).toEqual([['payment', 'tenant-002']])
  })

  it('records a reading only for a tenant with a meter', async () => {
    await openDialog({ step: 'tenant', kind: 'reading' })

    await chooseTenant(0)
    expect(dialog!.emitted('choose-tenant')).toBeUndefined()
    expect(body.get('[data-testid="quick-no-meter"]').text()).toContain("meter isn't set up")

    await chooseTenant(1)
    expect(dialog!.emitted('choose-tenant')).toEqual([['reading', 'tenant-002']])
  })

  it('offers the tenant whose page it was opened from, first', async () => {
    await openDialog({ step: 'tenant', kind: 'bill', preselected: tenants[1] })

    const shortcut = body.get('[data-testid="quick-preselected"]')
    expect(shortcut.text()).toContain('Mohammed Yusuf')

    await shortcut.trigger('click')

    expect(dialog!.emitted('choose-tenant')).toEqual([['bill', 'tenant-002']])
  })

  it('refuses a reading for a preselected tenant without a meter', async () => {
    await openDialog({ step: 'tenant', kind: 'reading', preselected: tenants[0] })

    await body.get('[data-testid="quick-preselected"]').trigger('click')

    expect(dialog!.emitted('choose-tenant')).toBeUndefined()
    expect(body.find('[data-testid="quick-no-meter"]').exists()).toBe(true)
  })

  it('asks which month for a bill, starting from the default', async () => {
    await openDialog({ ...monthStep, defaultMonth: '2026-10' })

    const input = body.get<HTMLInputElement>('#quick-month')
    expect(input.element.value).toBe('2026-10')

    await input.setValue('2026-12')
    await body.get('[data-testid="quick-month-step"]').trigger('submit')

    expect(dialog!.emitted('choose-month')).toEqual([['tenant-001', '2026-12']])
  })

  it('keeps the month the user typed when the default arrives later', async () => {
    await openDialog({ ...monthStep, defaultMonth: null })
    const input = body.get<HTMLInputElement>('#quick-month')
    expect(input.element.disabled).toBe(true)

    await atStep('month', 'bill', { defaultMonth: '2026-10' })
    expect(input.element.value).toBe('2026-10')
    expect(input.element.disabled).toBe(false)
  })

  it('drops the previous tenant’s month while the next tenant’s default loads', async () => {
    await openDialog({ ...monthStep, defaultMonth: '2026-10' })

    await atStep('month', 'bill', { billTenant: tenants[1], defaultMonth: null })
    const input = body.get<HTMLInputElement>('#quick-month')
    expect(input.element.value).toBe('')
    await body.get('[data-testid="quick-month-step"]').trigger('submit')
    expect(dialog!.emitted('choose-month')).toBeUndefined()

    await atStep('month', 'bill', { defaultMonth: '2026-08' })
    expect(input.element.value).toBe('2026-08')
    await body.get('[data-testid="quick-month-step"]').trigger('submit')
    expect(dialog!.emitted('choose-month')).toEqual([['tenant-002', '2026-08']])
  })

  it('does not continue without a valid month', async () => {
    await openDialog({ ...monthStep, defaultMonth: '2026-10' })

    await body.get('#quick-month').setValue('')
    await body.get('[data-testid="quick-month-step"]').trigger('submit')

    expect(dialog!.emitted('choose-month')).toBeUndefined()
  })

  it('asks to close on Escape', async () => {
    await openDialog()

    await body.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(dialog!.emitted('update:open')?.[0]).toEqual([false])
  })

  it('has no back arrow on the first step, and one on every later step', async () => {
    await openDialog()
    expect(body.find('[data-testid="quick-back"]').exists()).toBe(false)

    for (const step of ['tenant', 'month', 'charges', 'payment', 'confirm'] as const) {
      await atStep(step, 'bill', { billTenant: tenants[0], defaultMonth: '2026-10' })
      expect(body.find('[data-testid="quick-back"]').attributes('aria-label')).toBe('Back')
    }

    await body.get('[data-testid="quick-back"]').trigger('click')
    expect(dialog!.emitted('back')).toHaveLength(1)
  })

  it('titles the bill steps and shows the form only on them', async () => {
    await openDialog({
      step: 'charges',
      kind: 'bill',
      billTenant: tenants[0],
    })
    expect(body.get('[role="dialog"]').text()).toContain('Rent and utilities')
    expect(body.get('[data-testid="quick-bill-steps"]').isVisible()).toBe(true)

    await atStep('confirm', 'bill')
    expect(body.get('[role="dialog"]').text()).toContain('Confirm bill')

    await atStep('month', 'bill')
    expect(body.get('[data-testid="quick-bill-steps"]').isVisible()).toBe(false)
  })
})
