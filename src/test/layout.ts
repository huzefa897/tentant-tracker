// Helpers for layout tests (*.layout.spec.ts, run in a real browser by npm run test:layout).
import type { VueWrapper } from '@vue/test-utils'
import { page } from 'vitest/browser'

import '@/style.css'

let mounted: VueWrapper | undefined
let host: HTMLElement | undefined

// Sets the viewport width, then mounts with `mountIn` inside a box of `width` px (the card it
// sits in; the full width without it) once the app's fonts have loaded, so widths are measured
// as users see them:
//   await mountAt({ viewport: 360 }, (attachTo) => mount(RentEntryTotals, { props, attachTo }))
export async function mountAt<W extends VueWrapper>(
  { viewport, width }: { viewport: number; width?: number },
  mountIn: (attachTo: HTMLElement) => W,
): Promise<W> {
  unmountAll()
  await page.viewport(viewport, 900)
  host = document.createElement('div')
  host.style.width = width === undefined ? '100%' : `${width}px`
  document.body.style.margin = '0'
  document.body.append(host)
  const wrapper = mountIn(host)
  mounted = wrapper
  await document.fonts.ready
  // Measuring in a fallback font would prove nothing about what users see.
  if (!document.fonts.check('600 14px Poppins')) throw new Error('Poppins did not load')
  return wrapper
}

export function unmountAll() {
  mounted?.unmount()
  host?.remove()
  mounted = undefined
  host = undefined
}

// The elements whose content is wider than their box, so it spills over its neighbours.
export function overflowing(elements: Iterable<Element>): string[] {
  return [...elements]
    .filter((element) => element.scrollWidth > element.clientWidth)
    .map(
      (element) =>
        `${element.textContent?.trim()} (${element.scrollWidth}px in ${element.clientWidth}px)`,
    )
}

// Whether an element takes up room on the page (not display: none).
export function isShown(element: Element): boolean {
  return getComputedStyle(element).display !== 'none'
}
