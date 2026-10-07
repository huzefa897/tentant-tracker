import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LoadingRegion from '@/components/common/LoadingRegion.vue'
import SkeletonLines from '@/components/common/SkeletonLines.vue'
import SkeletonRows from '@/components/common/SkeletonRows.vue'
import TenantChipSkeleton from '@/components/tenant/TenantChipSkeleton.vue'

function bones(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[data-slot="skeleton"]')
}

describe('LoadingRegion', () => {
  it('announces its label and hides the placeholder shapes from screen readers', () => {
    const wrapper = mount(LoadingRegion, {
      props: { label: 'Loading entries…' },
      slots: { default: '<div data-testid="shape" />' },
    })

    expect(wrapper.attributes()).toMatchObject({ role: 'status', 'aria-busy': 'true' })
    expect(wrapper.text()).toBe('Loading entries…')
    expect(wrapper.get('.sr-only').text()).toBe('Loading entries…')
    expect(
      wrapper.get('[data-testid="shape"]').element.closest('[aria-hidden="true"]'),
    ).not.toBeNull()
  })
})

describe('SkeletonLines', () => {
  it('draws a label and a value per line', () => {
    expect(bones(mount(SkeletonLines))).toHaveLength(6)
    expect(bones(mount(SkeletonLines, { props: { lines: 5 } }))).toHaveLength(10)
  })

  it('adds a heading, a button and a card border when asked', () => {
    const wrapper = mount(SkeletonLines, {
      props: { lines: 2, heading: true, action: true, card: true },
    })

    expect(bones(wrapper)).toHaveLength(6)
    expect(wrapper.classes()).toContain('border')
  })

  it('has no border on its own', () => {
    expect(mount(SkeletonLines).classes()).not.toContain('border')
  })
})

describe('SkeletonRows', () => {
  it('draws the given number of rows, four by default', () => {
    expect(mount(SkeletonRows).findAll(':scope > div')).toHaveLength(4)
    expect(mount(SkeletonRows, { props: { rows: 2 } }).findAll(':scope > div')).toHaveLength(2)
  })

  it('sits in a rounded border when bordered', () => {
    expect(mount(SkeletonRows, { props: { bordered: true } }).classes()).toContain('rounded-xl')
    expect(mount(SkeletonRows).classes()).not.toContain('rounded-xl')
  })
})

describe('TenantChipSkeleton', () => {
  it('is a pill the size of the tenant tag', () => {
    expect(mount(TenantChipSkeleton).classes()).toEqual(
      expect.arrayContaining(['rounded-full', 'h-8']),
    )
  })
})
