import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), tailwindcss()],
  server: {
    // The app calls /api/v1 on its own origin (services/api.ts); in development that's
    // forwarded to Django, so no CORS setup is needed whichever port Vite picks.
    // API_PROXY_TARGET: Django elsewhere, e.g. the backend container (compose.yaml).
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
