import type { ReceiptIssuer } from '@/types/receipt'

// Shown on every receipt and copied into its snapshot when issued, so changing these later
// never changes a receipt already issued.
//
// The repo is public: personal details (names, the address, phone, email) come from
// `.env.local`, which is gitignored. See `.env.example`. They're printed on receipts, so being
// in the built bundle is fine; never put secrets in VITE_ variables.
export const RECEIPT_ISSUER_PLACEHOLDER_ADDRESS = 'Configure property address'

const env = import.meta.env

// Production builds refuse to issue receipts while the address is the placeholder
// (utils/receiptValidation.ts).
// contactNumber: E.164 (e.g. "+918341413827") or empty to leave it off the receipt.
export const receiptIssuer: ReceiptIssuer = {
  name: env.VITE_RECEIPT_ISSUER_NAME || 'Saleem Towers',
  managerName: env.VITE_RECEIPT_ISSUER_MANAGER ?? '',
  address: env.VITE_RECEIPT_ISSUER_ADDRESS || RECEIPT_ISSUER_PLACEHOLDER_ADDRESS,
  contactNumber: env.VITE_RECEIPT_ISSUER_PHONE ?? '',
  email: env.VITE_RECEIPT_ISSUER_EMAIL ?? '',
}
