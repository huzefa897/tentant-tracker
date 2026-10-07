# Payments and receipts

## Backend

**Payments** (`billing.Payment`) are money received against one bill (amount > 0, two places; paid date not after the property's `business_date()`, any earlier date; notes ≤ 500, trimmed). The tenancy and property come through the bill, never stored on the payment. Totals are always derived from the payment records (`calculations.total_paid_for` / `entry_amounts`).

- **Every payment is created by `billing/services.py` `record_payment`**, inside a transaction that locks the bill (`select_for_update`), rechecks access, then checks the idempotency key **before** the balance (so a retry of the payment that settled the bill still succeeds), then refuses more than the outstanding (409 `payment_exceeds_outstanding` with `outstandingAmount`).
- Each request carries an `Idempotency-Key` header (a UUID, required): the same key, bill, person and validated details returns the existing payment (200); anything else with that key is 409 `idempotency_conflict`. The unique key constraint is the last guard (the same key on two bills locks two rows): only that constraint, matched by name, is mapped, and looked up outside the failed transaction.
- API: `.../entries/{entryId}/payments/`. POST records (201, or 200 for a retry) and returns `{payment, entry}` with the bill's current balance; GET lists them newest paid date first, unpaginated.
- No update or delete; payments are view-only in admin, so nothing bypasses the service.
- A bill can be created with an initial payment through the same service ([rent-entries.md](rent-entries.md)).

## App

Payments (`types/payment.ts`) are recorded through `services/payment.service.ts` (`recordPayment`, `getPayments`; decimal strings out, validated `PaymentDto`s in). On the details page Record Payment opens `RecordPaymentForm` in a `Dialog` (a local preview of the remaining balance; the backend checks again), and `stores/rentEntry.ts` `addPayment` shows the **backend's** returned balance wherever the bill appears (cache, history page, dashboard summary), then reloads the bill's payment history (`loadPayments`, keyed by bill id; a failed load is an error with Retry, never "No payments"). An overpayment conflict refreshes the bill so the preview shows the current outstanding.

### Retries never record money twice

Pages own the idempotency key: `NewRentEntryView` one per bill; for payments the store keeps one per bill (`paymentKeyFor`), so closing the dialog or leaving the page keeps it, and the details page can't be left, nor the dialog closed, while a payment save is in flight.

- One key per intended operation, kept after an **uncertain** failure (`isUncertainFailure`: no response, 5xx, unreadable response; the error's `uncertain` flag) so saving again is a retry the backend recognises, and replaced after a success or a definite rejection (a 429 is definite: nothing was done).
- Editing the form between attempts is still safe: if the first attempt was saved, the changed request conflicts (`idempotency_conflict`, shown with the saved record) instead of saving a second one.
- A retry the backend answers with the existing payment says it "was already recorded".

## Receipts

**Paused until BE Phase 6.** `PaymentHistory` shows no receipt buttons (its `receipts` prop is off), and the receipt modules (`types/receipt.ts`, `utils/receipt*.ts`, `config/receiptIssuer.ts`) are kept, tested but unused, for Phase 6 to reconnect with backend payments. A receipt is a snapshot of one payment, never re-derived, downloaded as a PDF with jsPDF and Poppins; issuer details come from `VITE_RECEIPT_ISSUER_*` in `.env.local`.

The owners' current receipts come from the Google Sheet's Apps Script ([google-sheets-integration.md](google-sheets-integration.md)).
