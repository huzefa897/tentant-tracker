import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TenantSelector, { SEARCH_DEBOUNCE_MS } from '@/components/tenant/TenantSelector.vue'
import type { TenantListStatus } from '@/stores/tenant'
import { testTenants } from '@/test/mocks/tenantService'
import type { Tenant } from '@/types/tenant'

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

type Props = {
  tenants?: Tenant[]
  selectedTenant?: Tenant | null
  query?: string
  status?: TenantListStatus
  error?: string | null
  hasMore?: boolean
  loadingMore?: boolean
  disabled?: boolean
}

function mountSelector(props: Props = {}) {
  wrapper = mount(TenantSelector, {
    props: { tenants: testTenants, selectedTenant: null, query: '', status: 'ready', ...props },
    attachTo: document.body,
  })
  return wrapper
}

// The list renders in a portal on document.body, outside the wrapper.
const body = new DOMWrapper(document.body)

function trigger(selector: VueWrapper) {
  return selector.get('button[aria-label="Select tenant"]')
}

async function open(selector: VueWrapper) {
  await trigger(selector).trigger('click')
  await flushPromises()
}

function searchInput() {
  return body.get('input[aria-label="Search tenants"]')
}

function optionNames() {
  return body.findAll('[role="option"]').map((option) => option.get('p').text())
}

describe('TenantSelector', () => {
  it('shows a placeholder when nothing is selected', () => {
    expect(trigger(mountSelector()).text()).toContain('Search or select tenant...')
  })

  it('shows the selected tenant as "Name · Flat N", even when it isn’t in the results', () => {
    const selector = mountSelector({ tenants: [testTenants[1]!], selectedTenant: testTenants[0]! })

    expect(trigger(selector).text()).toContain('Shaik Zahid Ali · Flat 202')
  })

  it('lists the results it is given', async () => {
    await open(mountSelector())

    expect(optionNames()).toEqual(['Shaik Zahid Ali', 'Mohammed Yusuf', 'Ali Hussain'])
  })

  it('emits the search once typing pauses', async () => {
    vi.useFakeTimers()
    const selector = mountSelector()
    await open(selector)

    await searchInput().setValue('za')
    await searchInput().setValue('zahid ')
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)
    expect(selector.emitted('search')).toBeUndefined()

    vi.advanceTimersByTime(1)
    expect(selector.emitted('search')).toEqual([['zahid']])
  })

  it('doesn’t search again for the query already shown', async () => {
    vi.useFakeTimers()
    const selector = mountSelector({ query: 'zahid' })
    await open(selector)

    await searchInput().setValue(' zahid')
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)

    expect(selector.emitted('search')).toBeUndefined()
  })

  it('shows loading while results load', async () => {
    await open(mountSelector({ status: 'loading', tenants: [] }))

    expect(body.get('[data-testid="tenants-loading"]').text()).toBe('Loading tenants…')
    expect(optionNames()).toEqual([])
  })

  it('says when the property has no current tenants', async () => {
    await open(mountSelector({ tenants: [] }))

    expect(body.get('[data-testid="tenants-empty"]').text()).toBe('No current tenants found.')
  })

  it('says when a search matches nothing', async () => {
    await open(mountSelector({ tenants: [], query: 'nobody' }))

    expect(body.get('[data-testid="tenants-empty"]').text()).toBe('No matching tenants.')
  })

  it('shows the error instead of an empty list', async () => {
    await open(mountSelector({ status: 'error', tenants: [], error: 'Unable to load tenants.' }))

    expect(body.get('[role="alert"]').text()).toBe('Unable to load tenants.')
    expect(body.find('[data-testid="tenants-empty"]').exists()).toBe(false)
  })

  it('offers Load more when there are more results', async () => {
    const selector = mountSelector({ hasMore: true })
    await open(selector)

    const loadMore = body.findAll('button').find((b) => b.text() === 'Load more')!
    await loadMore.trigger('click')

    expect(selector.emitted('load-more')).toHaveLength(1)
  })

  it('shows a failed Load more below the results it keeps', async () => {
    await open(mountSelector({ hasMore: true, error: 'Unable to load tenants.' }))

    expect(optionNames()).toHaveLength(3)
    expect(body.get('[role="alert"]').text()).toBe('Unable to load tenants.')
  })

  it('offers no Load more on the last page', async () => {
    await open(mountSelector())

    expect(body.findAll('button').some((b) => b.text() === 'Load more')).toBe(false)
  })

  it('emits the tenant id when an option is chosen', async () => {
    const selector = mountSelector()
    await open(selector)

    await body.findAll('[role="option"]')[1]!.trigger('click')

    expect(selector.emitted('select')).toEqual([['tenant-002']])
  })

  it('clears the search after a selection and asks for the full list again', async () => {
    const selector = mountSelector({ tenants: [testTenants[0]!], query: 'zahid' })
    await open(selector)
    await searchInput().setValue('zahid')

    await body.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()

    expect(selector.emitted('search')).toEqual([['']])
    await open(selector)
    expect((searchInput().element as HTMLInputElement).value).toBe('')
  })

  it('disables the trigger when disabled', () => {
    expect(trigger(mountSelector({ disabled: true })).attributes('disabled')).toBeDefined()
  })
})
