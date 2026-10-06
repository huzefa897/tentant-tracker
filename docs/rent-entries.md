# Rent entries (bills)

## Backend

**Bills are rent entries** (`billing.RentEntry`): one per tenancy and billing month (stored as the first of the month), `PROTECT`ed from tenancy deletion.

- Rent and electricity rate are copied from the tenancy when the bill is created and never change after. Totals, paid, outstanding and status are derived in `billing/calculations.py` with `Decimal` (electricity rounded to paise, half up, **then** added to rent and water) and never stored.
- Database constraints back every rule (unique month, rent > 0, units/rate/water ≥ 0, first of month).
- The API (`/api/v1/properties/{id}/tenancies/{id}/entries/`, list/create, and `.../{entryId}/`) is scoped through `properties_for_user` then the tenancy, so others' bills 404; there's no update or delete.
- Creation goes through `billing/services.py` `create_rent_entry`, which locks the tenancy, rechecks that the month overlaps the occupancy (no proration), and assigns the rate, tenancy and creator itself. The rent is optional and defaults to the tenancy's. The serializer refuses unknown, server-assigned and payment fields rather than ignoring them.
- A duplicate month is 409 `duplicate_billing_month`, including when the unique constraint catches a race (only that constraint, matched by name, outside the failed transaction).
- Lists are newest month first, 12 per page, with `?year=` and `?billing_month=`.
- Concurrency tests (`billing/tests/test_concurrency.py`) need PostgreSQL.

## App: service and store

`services/rentEntry.service.ts` validates each response as a `RentEntryDto` and maps it to the app's `RentEntry` (`types/rentEntry.ts`; `tenantId` is the tenancy id, money becomes numbers), and sends new bills as decimal strings without a rate (`CreateRentEntryDto`). A saved bill carries **the backend's figures** (`electricityAmount`, `totalDue`, `totalPaid`, `outstanding`, `status`): screens display them and never recalculate. `utils/rentCalculations.ts` follows the backend's rule exactly (integer milli-units × paise, half up) for the form's **preview** only; the form's validation limits decimals (2 for money, 3 for units) and size to what the backend stores.

`stores/rentEntry.ts` holds the selected property's bills: a cache by id (`getEntry` matches **both** ids), one page of history (`loadHistory`), per-tenant summaries (`loadSummary`, numbered per tenant so an older or pre-save response never wins) and `addEntry`. Changing the selected property (switching, logout) resets it at once and discards pending responses. A failed load is an error with Retry, never an empty list or a zero balance.

## Saving a bill

`addEntry` adds a bill to state only after the backend returns it; on any failure nothing changes, the form keeps its values and no confirmation shows. It throws `EntrySaveError` with the message to show and, when that month now has a bill (a 409 duplicate, or a timeout/5xx after which it checks with `?billing_month=`), that `existingEntry`, so `NewRentEntryView` links to it instead of inviting another submission.

- The form (fields and Save) is disabled while in flight, so nothing typed during a save is lost.
- An unedited rent is sent as no rent (`useTenancyRent`), so the backend charges the tenancy's rent as it is now rather than the one the form loaded; an edited rent is an override.
- The confirmation shows the **returned** charges and figures, and says so when the rent or rate differed from the preview.

## History and details pages

History (`/tenants/:tenantId/entries`, `RentEntryHistoryView`) and details (`/tenants/:tenantId/entries/:entryId`, `RentEntryDetailsView`) take the tenant from the URL, never the dashboard selection, and the details page matches the entry on **both** ids so an entry never shows under another tenant. Both load the tenant and their bills from the backend themselves, so direct links and refreshes work (the details page through `composables/useRouteEntry.ts`, which reports a failed load as an error with Retry, never as "Entry not found").

- The router reuses a page when only its params change, so derive from the route props (computeds) rather than loading in `onMounted` alone, and reset page-local state such as the year filter and page when the tenant changes.
- History is **paginated by the backend** (12 a page, Newer/Older) with the year filter applied there; years offered come from the tenancy's dates.
- Totals (`sumEntryAmounts`, in paise) cover **this page only** and are labelled "Totals for this page", never the tenant's balance; the deposit is never applied to them.
- Back links use explicit routes, not `router.back()`; the details page goes back to Previous Entries unless opened with `?from=dashboard` (the dashboard's latest entry), which returns to the dashboard with that tenant selected.

## The old local ledger

**It is no longer read.** Bills, payments and receipts saved in this browser before BE Phase 4 stay untouched under `rent-tracker:rent-entries:v1` but nothing shows them. Never match them to tenancies by name or upload them automatically; importing needs an explicit id mapping.
