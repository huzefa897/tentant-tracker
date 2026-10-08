# Payments and receipts

## Backend

**Payments** (`billing.Payment`) are money received against one bill (amount > 0, two places; paid date not after the property's `business_date()`, any earlier date; notes ≤ 500, trimmed). The tenancy and property come through the bill, never stored on the payment. Totals are always derived from the payment records (`calculations.total_paid_for` / `entry_amounts`).

- **Every payment is created by `billing/services.py` `record_payment`**, inside a transaction that locks the bill (`select_for_update`), rechecks access, then checks the idempotency key **before** the balance (so a retry of the payment that settled the bill still succeeds), then refuses more than the outstanding (409 `payment_exceeds_outstanding` with `outstandingAmount`).
- While it holds that lock it numbers the payment on its bill (`sequence`: 1, 2, 3…; unique per bill, from 1). That's the durable record of the order payments were recorded in: receipts and the payment list use it, never `created_at`, which can tie or run backwards with the clock. Migration `0005` numbered existing payments by `created_at`, then id.
- Each request carries an `Idempotency-Key` header (a UUID, required): the same key, bill, person and validated details returns the existing payment (200); anything else with that key is 409 `idempotency_conflict`. The unique key constraint is the last guard (the same key on two bills locks two rows): only that constraint, matched by name, is mapped, and looked up outside the failed transaction.
- API: `.../entries/{entryId}/payments/`. POST records (201, or 200 for a retry) and returns `{payment, entry}` with the bill's current balance; GET lists them newest paid date first (the same day, latest recorded first), unpaginated.
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

A receipt confirms **one payment**: a ₹3,000 payment against a ₹15,750 bill gets a ₹3,000 receipt, which also shows the bill as it stood right after that payment, so it never implies the bill is paid.

### Backend

`billing.Receipt` is a snapshot, in explicit columns, of everything printed on the receipt: the issuer (the property's name, address and contact number, and the issuing person's name as "received by"), the tenancy (name, flat, mobile, deposit, rent due day), the bill's charges and electricity amount, its total due, paid **up to and including this payment** (the bill's payments with a `sequence` up to its own) and outstanding after it, what the previous month's bill still owed when it was issued, and the payment's amount, date and notes. It's never rebuilt from today's records: later payments or changed tenancy or property details never change it.

- **One per payment**, enforced by the database (`payment` is a unique one-to-one, `PROTECT`ed). The reference reads like the owners' receipt names, `Tenant_Name_Flat_Rent_Month YYYY` from the tenancy and billing month (`Shaik_Zahid_Ali_202_Rent_October 2026`, `models.receipt_reference`), with `_2`, `_3`… for the property's later receipts with the same name, flat and month (a bill's later payments, or two tenancies of the same name in one flat that both cover the month). It's set once when issued (renaming the tenant later never changes it) and is also the PDF's file name. References are unique **per property** (the receipt saves its `property`; `unique_receipt_reference_per_property`), so another property's tenant with the same name, flat and month never changes this one's number. Issuing locks the payment, then the bill, then the property (`FOR NO KEY UPDATE`, so new tenancies and bills aren't held up) while it numbers the reference: a property's receipts are numbered one at a time, the number is always free, and nothing is retried. Migration `0006` copied each existing receipt's property.
- **Every receipt is created by `billing/services.py` `issue_payment_receipt`**, inside a transaction that locks the payment (`select_for_update`), rechecks access (`ISSUE_RECEIPTS`), returns the payment's existing receipt **before** validating today's details (so an issued receipt reopens even if the address was cleared since), then requires the property's name and address and the tenant's name and flat (400 `receipt_configuration_incomplete`, its `detail` saying what to set) and copies the snapshot. The unique column is the last guard: only that constraint (`billing_receipt_payment_id_key`, matched by name) is mapped, outside the failed transaction. A failure saves nothing and leaves the payment as it was.
- API: `.../payments/{paymentId}/receipt/`. POST (empty body) issues it (201) or returns the one already issued (200), so no idempotency key is needed; GET returns it, or 404 if none was issued (it never issues one). The property, tenancy, bill and payment are each looked up only within the one before (`ScopedLookupMixin` in `billing/views.py`, shared with the bill and payment views), so another bill's payment is 404.
- Payments carry `receipt: {id, reference}` or `null`, loaded in the list's own query.
- No update or delete; receipts are view-only in admin (searchable by reference, tenant and flat). That isn't database-level immutability: keep receipt writes in the service. Corrections and voiding need their own workflow.

### App

`services/receipt.service.ts` (`issueReceipt`, `getReceipt`; validated `ReceiptDto`s mapped to `types/receipt.ts` `PaymentReceipt`, money as numbers). On the details page `PaymentHistory` (its `receipts` prop on) offers **Issue receipt** for a payment without one and **Download receipt** once it has one. Either way `stores/rentEntry.ts` `getReceipt(tenantId, payment)` gets the snapshot (GET when the payment has a receipt, otherwise POST; issued receipts are cached by payment id, since they never change) and marks the payment as having one, then the page downloads it as a PDF (`utils/receiptDownload.ts`: jsPDF and Poppins, laid out by `utils/receiptPdf.ts` from `utils/receiptContent.ts`, which reads only the snapshot and recalculates nothing).

- Wherever a bill's **View Summary** is offered (the dashboard's latest entry, `LatestEntryCard`, and each Previous Entries row, `RentEntryHistory`), a paid bill (anything paid) also offers **Download receipt**: the receipt for its most recent payment (newest paid date, then newest recorded), issued if it has none (`getLatestReceipt`, which always reloads the bill's payments first, never trusting a loaded list that may predate someone else's payment, and fails visibly if they can't be loaded). Its other payments' receipts are on the details page.
- Every page downloads through `composables/useReceiptDownload.ts` (`downloadPaymentReceipt`, `downloadLatestReceipt`): one download at a time, its id in `downloadingId`, the problem in `error`, shown inline above the card or table. Pages call `reset()` when they move to another tenant or bill: a download under way still finishes, but its error and wait don't carry over. Reopening an issued receipt that gets no response just says to try again; only issuing says it couldn't confirm whether one was issued.
- Every receipt button is disabled while one is being prepared ("Preparing…").
- A failure throws `ReceiptError` and never touches the payment. A lost response is `uncertain`: trying again is safe, since the backend returns the receipt it already issued. A refusal shows the backend's reason (e.g. the property's address isn't set). If only the PDF fails, the page says the receipt is issued and to try again.
- Nothing claims the file was saved: the browser decides that.

The owners' current receipts come from the Google Sheet's Apps Script ([google-sheets-integration.md](google-sheets-integration.md)).
