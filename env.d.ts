/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Optional: defaults to /api/v1 on the app's origin (proxied to Django in development).
  readonly VITE_API_BASE_URL?: string
  // Firebase web app config (services/firebase.ts). Public by design; never put secrets here.
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  // Receipt issuer details (config/receiptIssuer.ts). Public: they're printed on receipts.
  readonly VITE_RECEIPT_ISSUER_NAME?: string
  readonly VITE_RECEIPT_ISSUER_MANAGER?: string
  readonly VITE_RECEIPT_ISSUER_ADDRESS?: string
  readonly VITE_RECEIPT_ISSUER_PHONE?: string
  readonly VITE_RECEIPT_ISSUER_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
