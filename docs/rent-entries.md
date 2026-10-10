# Rent entries (bills)

## Backend

**Bills are rent entries** (`billing.RentEntry`): one **active** bill per tenancy and billing month (stored as the first of the month), `PROTECT`ed from tenancy deletion. Void bills stay beside it as history ([Correcting a bill](#correcting-a-bill)).

- Rent and electricity rate are copied from the tenancy when the bill is created and never change after. Totals, paid, outstanding and status are derived in `billing/calculations.py` with `Decimal` (electricity rounded to paise, half up, **then** added to rent and water) and never stored. Paid counts only payments that weren't reversed ([payments-and-receipts.md](payments-and-receipts.md#corrections-reversing-a-payment)), so a reversal can make a paid bill partially paid or unpaid again.
- Database constraints back every rule (one active bill per month, a conditional unique constraint `unique_active_tenancy_billing_month`; rent > 0, units/rate/water ≥ 0, first of month; void details present exactly when void).
- The API (`/api/v1/properties/{id}/tenancies/{id}/entries/`, list/create, and `.../{entryId}/`) is scoped through `properties_for_user` then the tenancy, so others' bills 404; there's no update or delete: a bill is voided or corrected instead.
- Creation goes through `billing/services.py` `create_rent_entry`, which locks the tenancy, rechecks that the month overlaps the occupancy (no proration), and assigns the rate, tenancy and creator itself. The rent is optional and defaults to the tenancy's. The serializer refuses unknown, server-assigned and payment fields rather than ignoring them.
- A duplicate month (one with an active bill) is 409 `duplicate_billing_month`, including when the unique constraint catches a race (only that constraint, matched by name, outside the failed transaction). A month whose only bills are void can have a new one.
- Lists are newest month first, 12 per page, with `?status=` (`active`, the default, so a caller that doesn't ask never sees void bills; `void`; `all`), `?year=` (0001–9999), `?billing_month=` and `?payment_status=` (active bills only; applied before paging; payments are summed in the list's own query by `RentEntry.objects.with_amounts()`, never once per bill); a malformed filter is a 400, never a 500.
- A bill can be created **with an initial payment** (`initialPayment`), in one transaction through the same `record_payment` lock as any payment ([payments-and-receipts.md](payments-and-receipts.md)): both are saved or neither. Bill creation takes an optional `Idempotency-Key` (required with an initial payment, which uses the same key): a retry returns the bill it created (200), compared against a fingerprint of the original request (`creation_fingerprint`), never its current balance, so later payments never make a genuine retry conflict.
- Concurrency tests (`billing/tests/test_concurrency.py`) need PostgreSQL.

## Correcting a bill

A bill is never edited or deleted. Two owner-only actions correct one; both only change the app's records, never money:

| Action           | When                                                     | Result                                                                            |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Void bill**    | The bill shouldn't exist (entered twice, wrong tenancy)  | The bill becomes void; its month can have a new bill                              |
| **Correct bill** | Its charges are wrong (e.g. October's electricity units) | The bill becomes void and its replacement, for the same month, is created with it |

**Payments first.** A bill is voided or corrected only when none of its payments still count. Otherwise the owner reverses each one first ([payments-and-receipts.md](payments-and-receipts.md#corrections-reversing-a-payment); that voids its receipt), then corrects the bill, then records the payments again against the replacement, deliberately. Payments are never moved, and a reversal refunds nothing.

### Backend

- Lifecycle fields on `RentEntry`: `status` (`active` | `void`), `voided_at`, `voided_by`, `void_reason` (a check constraint requires all three exactly when void) and `replaces_entry` (a `PROTECT`ed one-to-one to the void bill it replaces, so a bill is replaced at most once; reverse `replaced_by`). The original's charges, creator and timestamp never change.
- **Void bills count towards nothing.** `calculations.entry_amounts` keeps a void bill's `total_due` (to show) but gives it outstanding 0 and no payment status (`null` in the API, never "paid" or "unpaid"). `RentEntry.objects.active()` is what totals, the `?payment_status=` filter, the duplicate-month checks, a receipt's previous-month balance, the legacy import and `ledger_summary`'s money totals use (it counts void bills separately).
- Only owners (`Capability.CORRECT_BILLS`); a manager gets 403, someone without access 404. Checked in the view and again inside the service's transaction.
- **`void_rent_entry(entry_id, actor, reason)`**: locks the bill, rechecks access, refuses while payments count (`UnreversedPaymentsError`), voids it. A bill has one void, so a retry with the same reason returns it; another reason is `VoidConflictError`.
- **`correct_rent_entry(entry_id, actor, reason, validated_data, idempotency_key)`**: one transaction. Locks the bill, rechecks access, returns the key's earlier correction for a retry (matched on a fingerprint of the bill, reason and charges; anything else is `IdempotencyConflictError`), refuses a void bill (`EntryVoidError`), payments that count, or a replacement identical to the original (`NothingToCorrectError`), then locks the tenancy (NO KEY), voids the original and creates the replacement with the original's tenancy, month and electricity rate (never today's tenancy defaults) and the new rent, units, water and notes. Any failure, including the database refusing the replacement, rolls both back: the original stays active. The unique constraint is the last guard against a second active bill.
- **Lock order**, shared by every operation on an existing bill (payments, reversals, receipts, voids, corrections): the bill, its payments, its tenancy, its property. Creating a bill locks its tenancy and no existing bill, so the two never wait in a circle; a creation waiting behind a correction then finds the replacement and is refused. Under the bill's lock no payment can be recorded or reversed, and `record_payment` refuses a void bill (`EntryVoidError`). Concurrency tests in `billing/tests/test_concurrency.py`.
- API: `POST .../entries/{entryId}/void/` with `{"reason"}`: 201 with the bill, 200 for a retry, 409 `void_conflict` or `unreversed_payments`. `POST .../entries/{entryId}/correction/` with `{"reason", "rentAmount", "electricityUnits", "waterAmount", "notes"}` and a required `Idempotency-Key`: 201 with `{original, replacement}`, 200 for a retry; 409 `entry_void`, `unreversed_payments` or `idempotency_conflict`; 400 when nothing changed. The rate, month and tenancy are refused. Every bill in the API has `status`, `voidedAt`, `voidedByName`, `voidReason`, `replacesEntryId` and `replacedByEntryId`. A payment on a void bill is 409 `entry_void`.
- Read-only in admin (status filter, void details and both links). Migration `0009` added these; undoing it stops while any bill is void.

## App: service and store

`services/rentEntry.service.ts` validates each response as a `RentEntryDto` and maps it to the app's `RentEntry` (`types/rentEntry.ts`; `tenantId` is the tenancy id, money becomes numbers), and sends new bills as decimal strings without a rate (`CreateRentEntryDto`). A saved bill carries **the backend's figures** (`electricityAmount`, `totalDue`, `totalPaid`, `outstanding`, `status`): screens display them and never recalculate. `utils/rentCalculations.ts` follows the backend's rule exactly (integer milli-units × paise, half up) for the form's **preview** only; the form's validation limits decimals (2 for money, 3 for units) and size to what the backend stores.

`stores/rentEntry.ts` holds the selected property's bills: a cache by id (`getEntry` matches **both** ids), one page of history (`loadHistory`), per-tenant summaries (`loadSummary`, numbered per tenant so an older or pre-save response never wins) and `addEntry`. Changing the selected property (switching, logout) resets it at once and discards pending responses. A failed load is an error with Retry, never an empty list or a zero balance.

## Saving a bill

`addEntry(submission, idempotencyKey)` saves a bill, with the payment received with it if any (`initialPayment`; the backend saves both or neither), and adds it to state only after the backend returns it; on any failure nothing changes, the form keeps its values and no confirmation shows. It throws `EntrySaveError` with the message to show, the `existingEntry` when that month already has a bill (a 409 duplicate, or this key's earlier attempt saved one with other details) so `NewRentEntryView` links to it, and `uncertain` when there was no usable response. `NewRentEntryView` owns the key, one per bill; retries are covered in [payments-and-receipts.md](payments-and-receipts.md).

- The form (fields, Save and Cancel) is disabled while in flight, so nothing typed during a save is lost. The page also refuses to leave until the save settles (no discard dialog; signing out still leaves), so a bill can't be created after the user chose to discard it.
- An unedited rent is sent as no rent (`useTenancyRent`), so the backend charges the tenancy's rent as it is now rather than the one the form loaded; an edited rent is an override.
- The confirmation shows the **returned** charges and figures, and says so when the rent or rate differed from the preview.

## History and details pages

History (`/tenants/:tenantId/entries`, `RentEntryHistoryView`) and details (`/tenants/:tenantId/entries/:entryId`, `RentEntryDetailsView`) take the tenant from the URL, never the dashboard selection, and the details page matches the entry on **both** ids so an entry never shows under another tenant. Both load the tenant and their bills from the backend themselves, so direct links and refreshes work (the details page through `composables/useRouteEntry.ts`, which reports a failed load as an error with Retry, never as "Entry not found").

- The router reuses a page when only its params change, so derive from the route props (computeds) rather than loading in `onMounted` alone, and reset page-local state such as the filters and page when the tenant changes.
- History is **paginated by the backend** (12 a page, Newer/Older) with the year and payment-status filters applied there; years offered come from the tenancy's dates.
- Totals (`sumEntryAmounts`, in paise) cover **this page only** and are labelled "Totals for this page", never the tenant's balance; the deposit is never applied to them.
- Back links use explicit routes, not `router.back()`; the details page goes back to Previous Entries unless opened with `?from=dashboard` (the dashboard's latest entry), which returns to the dashboard with that tenant selected.

## The old local ledger

**It is no longer read.** Bills, payments and receipts saved in this browser before BE Phase 4 stay untouched under `rent-tracker:rent-entries:v1` but nothing shows them. Never match them to tenancies by name or upload them automatically; importing needs an explicit id mapping.
