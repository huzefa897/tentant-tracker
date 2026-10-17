import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { playwright } from '@vitest/browser-playwright'
import vue from '@vitejs/plugin-vue'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Layout tests (`npm run test:layout`): components rendered in headless Chromium with the app's
// real CSS, at set viewport widths, to catch what jsdom can't (it lays nothing out), such as
// amounts overlapping at narrow widths. Only `*.layout.spec.ts`; `npm test` stays on jsdom.
export default mergeConfig(
  // The app's config without the Vue devtools plugin, which errors inside the test browser.
  { ...viteConfig, plugins: [vue(), tailwindcss()] },
  defineConfig({
    test: {
      include: ['src/**/__tests__/*.layout.spec.ts'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
    },
  }),
)
