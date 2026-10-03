import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CountryFlag from '@/components/brand/CountryFlag.vue'
import { PHONE_COUNTRIES } from '@/utils/phoneCountries'

describe('CountryFlag', () => {
  it.each(PHONE_COUNTRIES.map((country) => country.code))('draws a flag for %s', (code) => {
    const wrapper = mount(CountryFlag, { props: { code } })
    const svg = wrapper.get('svg')

    expect(svg.attributes('data-flag')).toBe(code)
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.findAll('rect, path, circle').length).toBeGreaterThan(0)
  })
})
