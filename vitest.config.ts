import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      // Layout tests run in a real browser (vitest.layout.config.ts, npm run test:layout).
      exclude: [...configDefaults.exclude, 'e2e/**', '**/*.layout.spec.ts'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
