# Payments and receipts

**Paused until BE Phase 5**, when payments move to the backend.

Every backend bill is unpaid: `RentEntryForm`'s `paymentsEnabled` is false on the connected page (payment inputs disabled, `initialPayment` always `null`), `addEntry` refuses a submission with a payment rather than dropping it, and the details page says payments can't be recorded yet instead of offering Record Payment. Payment status filtering is gone for the same reason.

Kept, tested but unused, for Phase 5 to reconnect with backend ids:

- `RecordPaymentForm`, `PaymentHistory`, `types/payment.ts`.
- The receipt modules: `types/receipt.ts`, `utils/receipt*.ts`, `config/receiptIssuer.ts`. A receipt is a snapshot of one payment, never re-derived, downloaded as a PDF with jsPDF and Poppins; issuer details come from `VITE_RECEIPT_ISSUER_*` in `.env.local`.

The owners' current receipts come from the Google Sheet's Apps Script ([google-sheets-integration.md](google-sheets-integration.md)).
