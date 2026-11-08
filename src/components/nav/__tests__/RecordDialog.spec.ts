import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import RecordDialog from '@/components/nav/RecordDialog.vue'
import { testTenants } from '@/test/mocks/tenantService'

const body = new DOMWrapper(document.body)
let dialog: VueWrapper | undefined

// tenant-002 has a meter; the others don't.
const tenants = testTenants.map((tenant) =>
  tenant.id === 'tenant-002'
    ? { ...tenant, meterBaseline: { reading: 2400, readOn: '2026-09-01' } }
    : tenant,
)

async function openDialog() {
  dialog = mount(RecordDialog, {
    props: { open: false, tenants, query: '', status: 'ready' },
    attachTo: document.body,
  })
  await dialog.setProps({ open: true })
  await flushPromises()
  return dialog
}

async function chooseTenant(index: number) {
  await body.get('button[aria-label="Select tenant"]').trigger('click')
  await flushPromises()
  await body.findAll('[role="option"]')[index]!.trigger('click')
  await flushPromises()
}

afterEach(() => {
  dialog?.unmount()
  dialog = undefined
})

describe('RecordDialog', () => {
  it('asks what to record: a bill or a meter reading', async () => {
    await openDialog()

    expect(body.get('[role="dialog"]').text()).toContain('What would you like to record?')
    expect(body.find('[data-testid="record-bill"]').text()).toContain('New bill')
    expect(body.find('[data-testid="record-reading"]').text()).toContain('Meter reading')
  })

  it('records a bill for the tenant chosen', async () => {
    await openDialog()

    await body.get('[data-testid="record-bill"]').trigger('click')
    expect(body.get('[role="dialog"]').text()).toContain('Choose the tenant.')
    await chooseTenant(0)

    expect(dialog!.emitted('choose')).toEqual([['bill', 'tenant-001']])
  })

  it('records a reading only for a tenant with a meter', async () => {
    await openDialog()
    await body.get('[data-testid="record-reading"]').trigger('click')

    await chooseTenant(0)
    expect(dialog!.emitted('choose')).toBeUndefined()
    expect(body.get('[data-testid="record-no-meter"]').text()).toContain("meter isn't set up")

    await chooseTenant(1)
    expect(dialog!.emitted('choose')).toEqual([['reading', 'tenant-002']])
  })

  it('goes back to the choice, and starts from it each time it opens', async () => {
    await openDialog()
    await body.get('[data-testid="record-bill"]').trigger('click')

    await body.get('[data-testid="record-change"]').trigger('click')
    expect(body.find('[data-testid="record-kinds"]').exists()).toBe(true)

    await body.get('[data-testid="record-reading"]').trigger('click')
    await dialog!.setProps({ open: false })
    await dialog!.setProps({ open: true })
    await flushPromises()
    expect(body.find('[data-testid="record-kinds"]').exists()).toBe(true)
  })
})
