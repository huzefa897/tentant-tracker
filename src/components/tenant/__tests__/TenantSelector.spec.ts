import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import TenantSelector from '@/components/tenant/TenantSelector.vue'
import { mockTenants } from '@/data/tenants.mock'

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function mountSelector(props: { selectedTenantId?: string | null; disabled?: boolean } = {}) {
  wrapper = mount(TenantSelector, {
    props: { tenants: mockTenants, selectedTenantId: null, ...props },
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

async function search(query: string) {
  await searchInput().setValue(query)
  await flushPromises()
}

describe('TenantSelector', () => {
  it('shows a placeholder when nothing is selected', () => {
    expect(trigger(mountSelector()).text()).toContain('Search or select tenant...')
  })

  it('shows the selected tenant as "Name - Flat N"', () => {
    const selector = mountSelector({ selectedTenantId: 'tenant-001' })

    expect(trigger(selector).text()).toContain('Shaik Zahid Ali - Flat 202')
  })

  it('lists every tenant when opened', async () => {
    await open(mountSelector())

    expect(optionNames()).toEqual(['Shaik Zahid Ali', 'Mohammed Yusuf', 'Ali Hussain'])
  })

  it('filters by name, case-insensitively', async () => {
    await open(mountSelector())

    await search('ZAHID')

    expect(optionNames()).toEqual(['Shaik Zahid Ali'])
  })

  it('filters by flat number', async () => {
    await open(mountSelector())

    await search('301')

    expect(optionNames()).toEqual(['Mohammed Yusuf'])
  })

  it('shows an empty message when nothing matches', async () => {
    await open(mountSelector())

    await search('nobody')

    expect(optionNames()).toEqual([])
    expect(body.text()).toContain('No tenants found.')
  })

  it('emits the tenant id when an option is chosen', async () => {
    const selector = mountSelector()
    await open(selector)

    await body.findAll('[role="option"]')[1]!.trigger('click')

    expect(selector.emitted('select')).toEqual([['tenant-002']])
  })

  it('clears the search after a selection', async () => {
    const selector = mountSelector()
    await open(selector)
    await search('ali')

    await body.findAll('[role="option"]')[0]!.trigger('click')
    await flushPromises()
    await open(selector)

    expect((searchInput().element as HTMLInputElement).value).toBe('')
    expect(optionNames()).toHaveLength(3)
  })

  it('disables the trigger when disabled', () => {
    expect(trigger(mountSelector({ disabled: true })).attributes('disabled')).toBeDefined()
  })
})
