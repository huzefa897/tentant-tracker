// Helpers for layout tests (*.layout.spec.ts, run in a real browser by npm run test:layout).
import type { VueWrapper } from '@vue/test-utils'
import { page } from 'vitest/browser'

import '@/style.css'
// Poppins from npm, so the tests don't depend on the app's Google Fonts import arriving in
// time (it loads asynchronously, and CI may not reach it). The same files Google serves.
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'

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
  await poppinsLoaded()
  return wrapper
}

// The weights the app uses (style.css loads 400 to 700; loaded locally above).
const POPPINS_WEIGHTS = [400, 500, 600, 700]

// Measuring in a fallback font would prove nothing about what users see, so this fails unless
// every weight has a Poppins face that actually loaded. fonts.check() won't do: it's also true
// when no Poppins face exists at all (say the stylesheet was blocked). fonts.load() returns the
// matching faces, none if there are none.
async function poppinsLoaded() {
  for (const weight of POPPINS_WEIGHTS) {
    const faces = await document.fonts.load(`${weight} 14px Poppins`, '₹0123456789')
    if (!faces.some((face) => face.status === 'loaded')) {
      throw new Error(`Poppins ${weight} did not load, so widths would be measured wrongly`)
    }
  }
  await document.fonts.ready
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
