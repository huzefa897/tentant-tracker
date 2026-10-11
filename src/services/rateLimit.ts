// When the backend last refused a request for coming too often (429), and until when. Its limits
// are per address and per person, so automatic retries wait out the whole window rather than
// probe it. Only automatic retries consult this: a user pressing Retry always sends the request.

// Without a readable Retry-After (e.g. hidden by CORS), the minute RATE_LIMITED_MESSAGE promises.
const FALLBACK_MS = 60_000

let until = 0

// Retry-After is either seconds or an HTTP date.
function waitFor(retryAfter: unknown, now: number): number {
  if (typeof retryAfter !== 'string' || retryAfter.trim() === '') return FALLBACK_MS
  const value = retryAfter.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? FALLBACK_MS : Math.max(0, date - now)
}

export function noteRateLimited(retryAfter: unknown, now = Date.now()) {
  until = Math.max(until, now + waitFor(retryAfter, now))
}

// How long automatic retries should still wait; 0 when not rate limited.
export function rateLimitWaitMs(now = Date.now()): number {
  return Math.max(0, until - now)
}

export function resetRateLimit() {
  until = 0
}
