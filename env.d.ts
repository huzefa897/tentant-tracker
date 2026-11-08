/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Local development only (`npm run dev`): the email "Sign in as" on the login page uses, with
  // the backend on DJANGO_ENV=dev. Ignored in production builds.
  readonly VITE_DEV_LOGIN_EMAIL?: string
  // Optional: defaults to /api/v1 on the app's origin (proxied to Django in development).
  readonly VITE_API_BASE_URL?: string
  // Firebase web app config (services/firebase.ts). Public by design; never put secrets here.
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
