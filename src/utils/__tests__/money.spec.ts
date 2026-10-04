import { describe, expect, it } from 'vitest'

import { fromPaise, hasAtMostTwoDecimals, toPaise } from '@/utils/money'

describe('toPaise', () => {
  it.each([
    [0, 0],
    [1, 100],
    [10000, 1000000],
    [0.29, 29],
    [450.5, 45050],
    [0.1 + 0.2, 30],
  ])('%s rupees -> %s paise', (rupees, paise) => {
    expect(toPaise(rupees)).toBe(paise)
  })
})

describe('fromPaise', () => {
  it('converts back to rupees', () => {
    expect(fromPaise(1575050)).toBe(15750.5)
  })

  it('never returns -0', () => {
    expect(Object.is(fromPaise(-0), 0)).toBe(true)
  })
})

describe('hasAtMostTwoDecimals', () => {
  it.each([0, 1, 10.5, 10.25, 0.29, 1.01, 15750.99])('accepts %s', (value) => {
    expect(hasAtMostTwoDecimals(value)).toBe(true)
  })

  it.each([10.255, 0.001, 1.005, NaN, Infinity])('rejects %s', (value) => {
    expect(hasAtMostTwoDecimals(value)).toBe(false)
  })
})
