import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import TenantList from '@/components/tenant/TenantList.vue'
import { SEARCH_DEBOUNCE_MS } from '@/components/tenant/TenantSelector.vue'
import { testTenants } from '@/test/mocks/tenantService'

type Props = InstanceType<typeof TenantList>['$props']

function mountList(props: Partial<Props> = {}) {
  return mount(TenantList, {
    props: { tenants: testTenants, query: '', status: 'ready', ...props },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('TenantList', () => {
  it('lists each tenant with their flat, rent and due day', () => {
    const rows = mountList().findAll('[data-testid="tenant-list"] li')

    expect(rows).toHaveLength(3)
    expect(rows[0]!.text()).toContain('Shaik Zahid Ali')
    expect(rows[0]!.text()).toContain(`Flat ${testTenants[0]!.flatNumber}`)
    expect(rows[0]!.text()).toContain('Due')
  })

  it('opens a tenant', async () => {
    const list = mountList()

    await list.get('[data-testid="tenant-tenant-002"]').trigger('click')

    expect(list.emitted('open')).toEqual([['tenant-002']])
  })

  it('searches once typing pauses', async () => {
    vi.useFakeTimers()
    const list = mountList()

    await list.get('input[aria-label="Search tenants"]').setValue(' yusuf ')
    expect(list.emitted('search')).toBeUndefined()
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)

    expect(list.emitted('search')).toEqual([['yusuf']])
  })

  it('shows skeleton rows while loading, keeping the search box', () => {
    const list = mountList({ status: 'loading', tenants: [] })

    expect(list.get('[data-testid="tenants-loading"]').text()).toBe('Loading tenants…')
    expect(list.find('input[aria-label="Search tenants"]').exists()).toBe(true)
    expect(list.find('[data-testid="tenant-list"]').exists()).toBe(false)
  })

  it('shows a failed load as an error with Retry, never an empty list', async () => {
    const list = mountList({ status: 'error', tenants: [], error: 'Unable to load tenants.' })

    expect(list.get('[role="alert"]').text()).toContain('Unable to load tenants.')
    expect(list.find('[data-testid="tenants-empty"]').exists()).toBe(false)

    await list.get('[role="alert"] button').trigger('click')
    expect(list.emitted('retry')).toHaveLength(1)
  })

  it('says when there are no tenants, or none match', () => {
    expect(mountList({ tenants: [] }).get('[data-testid="tenants-empty"]').text()).toBe(
      'No current tenants.',
    )
    expect(
      mountList({ tenants: [], query: 'zz' }).get('[data-testid="tenants-empty"]').text(),
    ).toBe('No matching tenants.')
  })

  it('loads more when there are more', async () => {
    const list = mountList({ hasMore: true })

    const more = list.findAll('button').find((b) => b.text() === 'Load more')!
    await more.trigger('click')

    expect(list.emitted('load-more')).toHaveLength(1)
  })
})
