import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import router from '@/router'
import { ApiError } from '@/services/apiError'
import { meterReadingService } from '@/services/meterReading.service'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService } from '@/test/mocks/authService'
import {
  fakeMeters,
  makeReading,
  resetMeterReadingService,
  setFakeMeter,
} from '@/test/mocks/meterReadingService'
import { resetRentEntryService } from '@/test/mocks/rentEntryService'
import { fakeTenancies, resetTenantService, testTenants } from '@/test/mocks/tenantService'
import { openPage } from '@/test/rentEntries'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))
vi.mock('@/services/meterReading.service', () => import('@/test/mocks/meterReadingService'))

const getMeter = vi.mocked(meterReadingService.getMeter)
const body = new DOMWrapper(document.body)
let view: VueWrapper | undefined

const baseline = { reading: 2400, readOn: '2026-09-01' }

function withMeter() {
  fakeTenancies.tenants = testTenants.map((tenant) =>
    tenant.id === 'tenant-001' ? { ...tenant, meterBaseline: baseline } : tenant,
  )
}

async function openMeter() {
  view = await openPage('/tenants/tenant-001/meter')
  return view
}

function button(label: string) {
  const match = body.findAll('button').find((b) => b.text() === label)
  if (!match) throw new Error(`No "${label}" button`)
  return match
}

beforeEach(() => {
  resetTenantService()
  resetAuthService()
  resetAccessService()
  resetRentEntryService()
  resetMeterReadingService()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 5, 12))
})

afterEach(() => {
  view?.unmount()
  view = undefined
  vi.useRealTimers()
})

describe('MeterReadingsView', () => {
  it('says the meter isn’t set up, without asking for readings', async () => {
    await openMeter()

    expect(view!.get('[data-testid="meter-not-set-up"]').text()).toContain("isn't set up")
    expect(getMeter).not.toHaveBeenCalled()
  })

  it('shows the baseline, the last billed reading and the readings', async () => {
    withMeter()
    setFakeMeter(
      'tenant-001',
      baseline,
      [
        makeReading({
          reading: 2563,
          readOn: '2026-10-31',
          billedBy: { id: 'oct', billingMonth: '2026-10' },
        }),
      ],
      { id: 'r1', reading: 2563, readOn: '2026-10-31' },
    )
    await openMeter()

    const summary = view!.get('[data-testid="meter-summary"]').text()
    expect(summary).toContain('Starting reading2,400')
    expect(summary).toContain('Billed up to2,563')
    expect(view!.get('[data-testid="meter-reading"]').text()).toContain(
      '163 units since the previous',
    )
  })

  it('records a reading and shows the meter the backend returns', async () => {
    withMeter()
    setFakeMeter('tenant-001', baseline)
    await openMeter()

    await button('Record reading').trigger('click')
    await flushPromises()
    await body.get('#meter-reading').setValue('2600')
    await body.get('#meter-readOn').setValue('2026-11-01')
    await body.get('form').trigger('submit')
    await flushPromises()

    expect(fakeMeters.meters['tenant-001']!.readings.map((r) => r.reading)).toEqual([2600])
    expect(view!.get('[data-testid="meter-reading"]').text()).toContain(
      '200 units since the previous',
    )
    expect(body.find('#meter-reading').exists()).toBe(false)
  })

  it('opens Record reading by itself when opened to record one (?record=1)', async () => {
    withMeter()
    setFakeMeter('tenant-001', baseline)
    view = await openPage('/tenants/tenant-001/meter?record=1')

    expect(body.get('[role="dialog"]').text()).toContain('Record reading')
    expect(body.find('#meter-reading').exists()).toBe(true)
  })

  it('waits to be asked without ?record=1', async () => {
    withMeter()
    setFakeMeter('tenant-001', baseline)
    await openMeter()

    expect(body.find('[role="dialog"]').exists()).toBe(false)
  })

  it('lists the bills that block voiding a billed reading, keeping the dialog open', async () => {
    withMeter()
    setFakeMeter('tenant-001', baseline, [
      makeReading({ reading: 2563, billedBy: { id: 'oct', billingMonth: '2026-10' } }),
    ])
    await openMeter()

    await view!.get('[aria-label="Void reading 2,563"]').trigger('click')
    await flushPromises()
    await body.get('#void-reading-reason').setValue('Wrong tenant')
    await body.get('form').trigger('submit')
    await flushPromises()

    expect(body.get('[data-testid="blocking-bills"]').text()).toContain('October 2026 bill')
    expect(body.text()).toContain('Bills are measured from this reading.')

    await button('October 2026 bill').trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
  })

  it('shows a failed load as an error with Retry, never an empty meter', async () => {
    withMeter()
    setFakeMeter('tenant-001', baseline)
    getMeter.mockRejectedValueOnce(new ApiError('unavailable'))
    await openMeter()

    expect(view!.text()).toContain("Couldn't load the meter readings.")
    expect(view!.find('[data-testid="meter-summary"]').exists()).toBe(false)
  })
})
