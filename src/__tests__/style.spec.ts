import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// `npx shadcn-vue add` rewrites the font import; the app must load the font it renders with.
// Read from disk: Vitest blanks CSS imports.
const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8')

describe('style.css', () => {
  it('loads the font the theme uses', () => {
    const imported = /fonts\.googleapis\.com\/css2\?family=([^:&']+)/.exec(css)?.[1]
    const themed = /--font-sans:\s*'([^']+)'/.exec(css)?.[1]

    expect(themed).toBe('Poppins')
    expect(imported?.replace(/\+/g, ' ')).toBe(themed)
  })
})
