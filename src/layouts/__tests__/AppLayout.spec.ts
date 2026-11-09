import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AppLayout from '@/layouts/AppLayout.vue'
import router from '@/router'
import { useAccessStore } from '@/stores/access'
import { useAuthStore } from '@/stores/auth'
import { resetAccessService } from '@/test/mocks/accessService'
import { resetAuthService, signInAs } from '@/test/mocks/authService'
import { rentEntryService, resetRentEntryService } from '@/test/mocks/rentEntryService'
import { fakeTenancies, resetTenantService, tenantService } from '@/test/mocks/tenantService'

vi.mock('@/services/auth.service', () => import('@/test/mocks/authService'))
vi.mock('@/services/access.service', () => import('@/test/mocks/accessService'))
vi.mock('@/services/tenant.service', () => import('@/test/mocks/tenantService'))
vi.mock('@/services/rentEntry.service', () => import('@/test/mocks/rentEntryService'))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  resetAuthService()
  resetAccessService()
  resetTenantService()
  resetRentEntryService()
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountLayout(slots: Record<string, string> = {}) {
  wrapper = mount(AppLayout, {
    slots: { default: '<p data-testid="page">Page content</p>', ...slots },
    global: { plugins: [router] },
    attachTo: document.body,
  })
  return wrapper
}

describe('AppLayout', () => {
  it('renders the page content inside the card', () => {
    expect(mountLayout().find('[data-testid="app-card"] [data-testid="page"]').exists()).toBe(true)
  })

  it('puts the logo and account menu above the card, not in it', () => {
    const layout = mountLayout()
    const header = layout.get('[data-testid="app-header"]')

    expect(header.text()).toContain('Tenant Manager')
    expect(header.find('[data-testid="user-menu-trigger"]').exists()).toBe(true)
    expect(layout.find('[data-testid="app-card"] [data-testid="app-header"]').exists()).toBe(false)
  })

  it('names the account from /me', async () => {
    signInAs()
    await useAuthStore().init()
    await useAccessStore().load()

    const layout = mountLayout()
    await flushPromises()

    expect(layout.get('[data-testid="user-menu-name"]').text()).toBe('Test Owner')
  })

  it('shows the toolbar at the top of the card', () => {
    const layout = mountLayout({ toolbar: '<input data-testid="search" />' })
    const toolbar = layout.get('[data-testid="app-card"] [data-testid="app-toolbar"]')

    expect(toolbar.find('[data-testid="search"]').exists()).toBe(true)
  })

  it('leaves out the row when a screen has no toolbar', () => {
    expect(mountLayout().find('[data-testid="app-toolbar"]').exists()).toBe(false)
  })

  it('fills the screen instead of a narrow centred card', () => {
    const card = mountLayout().get('[data-testid="app-card"]')

    expect(card.classes()).not.toContain('max-w-5xl')
    expect(card.element.parentElement!.classList).toContain('max-w-[1800px]')
  })

  // Each screen mounts its own layout, so this plays on every screen change.
  it('eases the page content in', () => {
    expect(mountLayout().get('[data-testid="app-content"]').classes()).toContain('animate-page-in')
  })

  describe('nav', () => {
    const body = new DOMWrapper(document.body)

    async function mountSignedIn(path = '/dashboard') {
      signInAs()
      await useAuthStore().init()
      await useAccessStore().load()
      // A query string in `path` is dropped by the router, so it is passed as `query`.
      const [pathname, search] = path.split('?')
      const query = Object.fromEntries(new URLSearchParams(search))
      await router.push({ path: pathname, query, force: true })
      const layout = mountLayout()
      await flushPromises()
      return layout
    }

    it('waits for a property before showing the sections', () => {
      const layout = mountLayout()

      expect(layout.find('[data-testid="app-nav-bar"]').exists()).toBe(false)
      expect(layout.find('[data-testid="app-nav-header"]').exists()).toBe(false)
    })

    it('floats Home, Tenants, Quick entry and Account at the bottom, as real links', async () => {
      const bar = (await mountSignedIn()).get('[data-testid="app-nav-bar"]')

      expect(bar.findAll('a').map((link) => [link.text(), link.attributes('href')])).toEqual([
        ['Home', '/dashboard'],
        ['Tenants', '/tenants'],
        ['Account', '/account'],
      ])
      expect(bar.find('[data-testid="nav-quick-entry"]').attributes('aria-label')).toBe(
        'Quick entry',
      )
    })

    it('puts Home, Tenants and Quick entry in the header, beside the account menu', async () => {
      const header = (await mountSignedIn()).get('[data-testid="app-header"]')

      expect(header.findAll('[data-testid="app-nav-header"] a').map((a) => a.text())).toEqual([
        'Home',
        'Tenants',
      ])
      expect(header.find('[data-testid="user-menu-trigger"]').exists()).toBe(true)
    })

    it('marks the current section', async () => {
      const bar = (await mountSignedIn('/dashboard')).get('[data-testid="app-nav-bar"]')

      expect(bar.get('[aria-current="page"]').text()).toBe('Home')
    })

    it('navigates in the app on a click', async () => {
      const layout = await mountSignedIn()

      await layout.get('[data-testid="app-nav-bar"] [data-testid="nav-account"]').trigger('click')

      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('account'))
    })

    it('gives way to the keyboard while a field has focus', async () => {
      const layout = await mountSignedIn()
      const bar = layout.get('[data-testid="app-nav-bar"]')
      const input = document.createElement('input')
      layout.get('[data-testid="app-content"]').element.append(input)

      input.focus()
      await flushPromises()
      expect(bar.isVisible()).toBe(false)

      input.blur()
      await flushPromises()
      expect(bar.isVisible()).toBe(true)
      input.remove()
    })

    describe('with a visual viewport', () => {
      const viewport = Object.assign(new EventTarget(), { height: 0, scale: 1 })

      function setViewportHeight(height: number, scale = 1) {
        viewport.height = height
        viewport.scale = scale
        viewport.dispatchEvent(new Event('resize'))
      }

      beforeEach(() => {
        viewport.height = window.innerHeight
        viewport.scale = 1
        Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
      })

      afterEach(() => {
        Reflect.deleteProperty(window, 'visualViewport')
      })

      async function focusedField() {
        const layout = await mountSignedIn()
        const input = document.createElement('input')
        layout.get('[data-testid="app-content"]').element.append(input)
        return { bar: layout.get('[data-testid="app-nav-bar"]'), input }
      }

      it('hides while the keyboard is open over a field, and returns when it is closed', async () => {
        const { bar, input } = await focusedField()

        setViewportHeight(window.innerHeight - 300)
        input.focus()
        await flushPromises()
        expect(bar.isVisible()).toBe(false)

        // The keyboard is dismissed, but the field keeps focus.
        setViewportHeight(window.innerHeight)
        await flushPromises()
        expect(document.activeElement).toBe(input)
        expect(bar.isVisible()).toBe(true)

        input.remove()
      })

      it('stays with a field focused and no keyboard (a hardware keyboard)', async () => {
        const { bar, input } = await focusedField()

        input.focus()
        await flushPromises()

        expect(bar.isVisible()).toBe(true)
        input.remove()
      })

      it('does not take zooming in for a keyboard', async () => {
        const { bar, input } = await focusedField()

        input.focus()
        setViewportHeight(window.innerHeight / 2, 2)
        await flushPromises()

        expect(bar.isVisible()).toBe(true)
        input.remove()
      })
    })

    describe('Quick entry', () => {
      const QUICK_ENTRY = '[data-testid="app-nav-bar"] [data-testid="nav-quick-entry"]'

      async function openQuickEntry(path = '/dashboard') {
        const layout = await mountSignedIn(path)
        await layout.get(QUICK_ENTRY).trigger('click')
        await flushPromises()
        return layout
      }

      async function chooseTenant(index: number) {
        await body.get('button[aria-label="Select tenant"]').trigger('click')
        await flushPromises()
        await body.findAll('[role="option"]')[index]!.trigger('click')
        await flushPromises()
      }

      it('opens as a history entry and closes with the browser back', async () => {
        await openQuickEntry()

        expect(router.currentRoute.value.query.quick).toBe('start')
        expect(body.get('[role="dialog"]').text()).toContain('What would you like to record?')

        router.back()
        await vi.waitFor(() => expect(router.currentRoute.value.query.quick).toBeUndefined())
        await flushPromises()
        expect(body.find('[role="dialog"]').exists()).toBe(false)
      })

      it('goes back one step at a time, then closes', async () => {
        await openQuickEntry()
        await body.get('[data-testid="quick-bill"]').trigger('click')
        await flushPromises()
        expect(router.currentRoute.value.query.quick).toBe('bill')
        expect(body.get('[role="dialog"]').text()).toContain('Choose the tenant.')

        router.back()
        await vi.waitFor(() => expect(router.currentRoute.value.query.quick).toBe('start'))
        await flushPromises()
        expect(body.find('[data-testid="quick-kinds"]').exists()).toBe(true)

        router.back()
        await vi.waitFor(() => expect(router.currentRoute.value.query.quick).toBeUndefined())
      })

      it('closes from a later step with one close, leaving the page as it was', async () => {
        await openQuickEntry()
        await body.get('[data-testid="quick-bill"]').trigger('click')
        await flushPromises()

        await body.get('[data-slot="dialog-close"]').trigger('click')

        await vi.waitFor(() => expect(router.currentRoute.value.query.quick).toBeUndefined())
        expect(router.currentRoute.value.name).toBe('dashboard')
      })

      it('closes on Escape', async () => {
        await openQuickEntry()

        await body.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })

        await vi.waitFor(() => expect(router.currentRoute.value.query.quick).toBeUndefined())
      })

      it('takes a bill through its steps, with a way back from each', async () => {
        await openQuickEntry()
        await body.get('[data-testid="quick-bill"]').trigger('click')
        await flushPromises()
        await chooseTenant(1)

        expect(router.currentRoute.value.query).toMatchObject({
          quick: 'bill',
          step: 'month',
          quickTenant: 'tenant-002',
        })
        await body.get('#quick-month').setValue('2026-11')
        await body.get('[data-testid="quick-month-step"]').trigger('submit')
        await flushPromises()
        expect(router.currentRoute.value.query).toMatchObject({
          step: 'charges',
          quickMonth: '2026-11',
        })
        expect(body.get('[role="dialog"]').text()).toContain('Rent and utilities')

        await body.get('#electricityUnits').setValue('100')
        await body.get('[data-testid="quick-bill-steps"] form').trigger('submit')
        await flushPromises()
        expect(router.currentRoute.value.query.step).toBe('payment')
        expect(body.get('[data-testid="total-due"]').text()).toBe('₹18,600')

        await body.get('[data-testid="quick-bill-steps"] form').trigger('submit')
        await flushPromises()
        expect(router.currentRoute.value.query.step).toBe('confirm')
        expect(body.get('[role="dialog"]').text()).toContain('Save this bill?')

        await body.get('[data-testid="quick-back"]').trigger('click')
        await vi.waitFor(() => expect(router.currentRoute.value.query.step).toBe('payment'))
      })

      it('keeps the bill being made when stepping back to the month and on again', async () => {
        await openQuickEntry()
        await body.get('[data-testid="quick-bill"]').trigger('click')
        await flushPromises()
        await chooseTenant(1)
        await body.get('#quick-month').setValue('2026-11')
        await body.get('[data-testid="quick-month-step"]').trigger('submit')
        await flushPromises()
        await body.get('#electricityUnits').setValue('123')

        router.back()
        await vi.waitFor(() => expect(router.currentRoute.value.query.step).toBe('month'))
        await flushPromises()
        expect(router.currentRoute.value.query.quickMonth).toBeUndefined()
        await body.get('[data-testid="quick-month-step"]').trigger('submit')
        await flushPromises()

        expect(router.currentRoute.value.query.step).toBe('charges')
        expect(body.get<HTMLInputElement>('#electricityUnits').element.value).toBe('123')
      })

      it('starts a new bill when the month is changed on the way back', async () => {
        await openQuickEntry()
        await body.get('[data-testid="quick-bill"]').trigger('click')
        await flushPromises()
        await chooseTenant(1)
        await body.get('#quick-month').setValue('2026-11')
        await body.get('[data-testid="quick-month-step"]').trigger('submit')
        await flushPromises()
        await body.get('#electricityUnits').setValue('123')

        router.back()
        await vi.waitFor(() => expect(router.currentRoute.value.query.step).toBe('month'))
        await flushPromises()
        await body.get('#quick-month').setValue('2026-12')
        await body.get('[data-testid="quick-month-step"]').trigger('submit')
        await flushPromises()

        expect(router.currentRoute.value.query.quickMonth).toBe('2026-12')
        expect(body.get<HTMLInputElement>('#electricityUnits').element.value).toBe('')
      })

      it('returns to the page it was opened from, not the sheet, when back is pressed after a save', async () => {
        await openQuickEntry()
        await body.get('[data-testid="quick-bill"]').trigger('click')
        await flushPromises()
        await chooseTenant(1)
        await body.get('#quick-month').setValue('2026-11')
        await body.get('[data-testid="quick-month-step"]').trigger('submit')
        await flushPromises()
        await body.get('#electricityUnits').setValue('100')
        await body.get('[data-testid="quick-bill-steps"] form').trigger('submit')
        await flushPromises()
        await body.get('[data-testid="quick-bill-steps"] form').trigger('submit')
        await flushPromises()

        await body.get('[data-testid="quick-bill-steps"] form').trigger('submit')

        await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
        expect(router.currentRoute.value.query.quick).toBeUndefined()

        router.back()
        await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('dashboard'))
        expect(router.currentRoute.value.query.quick).toBeUndefined()
        await flushPromises()
        expect(body.find('[role="dialog"]').exists()).toBe(false)
      })

      it('stays on the confirm step while a save is in flight, then opens the bill', async () => {
        const create = rentEntryService.createEntry.getMockImplementation()!
        let release = () => {}
        rentEntryService.createEntry.mockImplementation(
          (...args: unknown[]) =>
            new Promise((resolve) => {
              release = () => resolve(create(...args))
            }),
        )
        await openQuickEntry()
        await body.get('[data-testid="quick-bill"]').trigger('click')
        await flushPromises()
        await chooseTenant(1)
        await body.get('#quick-month').setValue('2026-11')
        await body.get('[data-testid="quick-month-step"]').trigger('submit')
        await flushPromises()
        await body.get('#electricityUnits').setValue('100')
        await body.get('[data-testid="quick-bill-steps"] form').trigger('submit')
        await flushPromises()
        await body.get('[data-testid="quick-bill-steps"] form').trigger('submit')
        await flushPromises()
        await body.get('[data-testid="quick-bill-steps"] form').trigger('submit')
        await flushPromises()

        await body.get('[data-testid="quick-back"]').trigger('click')
        await body.get('[data-slot="dialog-close"]').trigger('click')
        router.back()
        await flushPromises()

        expect(router.currentRoute.value.query.step).toBe('confirm')
        expect(body.find('[role="dialog"]').exists()).toBe(true)

        release()
        await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-details'))
      })

      it('restores a reloaded bill step for a tenant the first search page does not hold', async () => {
        fakeTenancies.pageSize = 1

        await mountSignedIn(
          '/dashboard?quick=bill&step=charges&quickTenant=tenant-002&quickMonth=2026-11',
        )
        await flushPromises()

        expect(tenantService.getTenant).toHaveBeenCalled()
        expect(body.get('[role="dialog"]').text()).toContain('Rent and utilities')
      })

      it('opens the tenant’s bills to take a payment on one', async () => {
        await openQuickEntry()
        await body.get('[data-testid="quick-payment"]').trigger('click')
        await flushPromises()
        await chooseTenant(0)

        await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('rent-entry-history'))
        expect(router.currentRoute.value.params.tenantId).toBe('tenant-001')
      })

      it('offers the tenant whose page it was opened from', async () => {
        const layout = await mountSignedIn('/tenants/tenant-002')
        await layout.get(QUICK_ENTRY).trigger('click')
        await flushPromises()
        await body.get('[data-testid="quick-bill"]').trigger('click')
        await flushPromises()

        expect(body.get('[data-testid="quick-preselected"]').text()).toContain('Mohammed Yusuf')
      })
    })
  })
})
