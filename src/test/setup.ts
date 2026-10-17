import { beforeEach, vi } from 'vitest'

// Browser APIs reka-ui relies on that jsdom doesn't implement.

Element.prototype.scrollIntoView ??= function () {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= function () {}

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The dashboard is where sign-in lands, so every test gets the dashboard fake: none may reach
// the API through it. Its own spec uses the real one (vi.unmock).
vi.mock('@/services/dashboard.service', () => import('@/test/mocks/dashboardService'))

beforeEach(async () => {
  const { resetDashboardService } = await import('@/test/mocks/dashboardService')
  resetDashboardService()
})
