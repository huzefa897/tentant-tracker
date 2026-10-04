/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
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
