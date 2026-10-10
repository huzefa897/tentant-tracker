import { beforeEach, describe, expect, it } from 'vitest'

import { noteRateLimited, rateLimitWaitMs, resetRateLimit } from '@/services/rateLimit'

const NOW = Date.parse('2026-10-11T10:00:00Z')

beforeEach(() => {
  resetRateLimit()
})

describe('rate limit window', () => {
  it('is open when nothing was rate limited', () => {
    expect(rateLimitWaitMs(NOW)).toBe(0)
  })

  it('waits the seconds Retry-After gives', () => {
    noteRateLimited('42', NOW)

    expect(rateLimitWaitMs(NOW)).toBe(42_000)
    expect(rateLimitWaitMs(NOW + 40_000)).toBe(2_000)
    expect(rateLimitWaitMs(NOW + 42_000)).toBe(0)
  })

  it('waits until the HTTP date Retry-After gives', () => {
    noteRateLimited('Sun, 11 Oct 2026 10:00:30 GMT', NOW)

    expect(rateLimitWaitMs(NOW)).toBe(30_000)
  })

  it.each([undefined, null, '', 'soon', 7])('waits a minute when Retry-After is %j', (value) => {
    noteRateLimited(value, NOW)

    expect(rateLimitWaitMs(NOW)).toBe(60_000)
  })

  it('keeps the later window when a shorter one follows', () => {
    noteRateLimited('60', NOW)
    noteRateLimited('5', NOW + 1_000)

    expect(rateLimitWaitMs(NOW + 1_000)).toBe(59_000)
  })
})
