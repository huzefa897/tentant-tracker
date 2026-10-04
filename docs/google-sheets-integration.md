# Google Sheets integration (later phase)

**Status:** not started. These notes come from reviewing the current spreadsheet
(`TenantTracker.xlsx`) and its Google Apps Script. Read this before starting the phase that
connects the app to Google Sheets.

> **This repository is public.** Never commit the real spreadsheet, an export of it, or the
> script with its current `CONFIG`. The sheet holds tenants' names, phone numbers, deposit
> amounts and **Aadhaar numbers**; the script holds the owners' email addresses, phone number
> and home address. If test data is needed, commit an anonymised sample with the same layout.

## How the spreadsheet works today

### Tabs

- `README`: instructions for adding a tenant.
- `Template`: blank tenant tab, copied to add a tenant.
- **One tab per tenant**, named after the tenant. A tenant who rents a second flat gets a
  second tab.
- `Email Log`: written by the script (timestamp, sheet, row, status, detail).

### Tenant tab layout

A details block at the top, then one row per month.

**Details (rows 3–8):** labels in column A, values in column C, plus a few extra label/value
pairs in columns D–G.

| Label | Value | Notes |
|---|---|---|
| Name of Tenant | text | |
| Rent Amount | number | the tenant's **current** rent |
| Flat Number | D4 → F4 (G4 on one tab) | usually a number such as `202`, stored as `202.0`; one test tab has a street address |
| Rent Due Day (of month) | number, text such as `11th `, or blank | |
| Electricity Per Unit Cost | number | the **current** rate |
| Tenant Mobile Number | text | not E.164: spaces, no country code, one 9-digit number, one Australian number |
| Tenant Deposit Amount | number | |
| Adhaar Card Number | D5 → F5, on most tabs | sensitive government ID |
| Breakdown | e.g. `15000+2000 Maintainance` | rent split into rent and maintenance, as free text |
| Tenant Email | read by the script, but not present on any tab | |

**Monthly rows:** header in row 10 (the script finds it by looking for `Month` in column A),
data from row 11.

| Column | Header | Content |
|---|---|---|
| A | Month | date, 1st of the billing month |
| B | Rent Amount | usually `=$C$4` (the current rent), sometimes typed in |
| C | Status | formula: `Paid` if Paid Date isn't empty, else `Overdue` after the due day, else `Unpaid` |
| D | Units Used | typed in |
| E | Electricity Charge | `=D × $C$6` (the current rate) |
| F | Water Bill | typed in, often blank |
| G | Total Due | rent + water + electricity **+ last month's Overdue Amount** (carry-forward) |
| H | Total Paid | one number per month |
| I | Paid Date | one date per month |
| J | Notes | free text |
| K | Email Trigger | checkbox that forces the receipt to be re-sent |
| L | Overdue Amount | `=SUM(G − H)` |

Header positions vary between tabs; the script reads by header label, not fixed column.

### Data problems found

These need fixing or handling before any data is imported:

1. **Carry-forward counted twice:** on two tabs, Total Due adds last month's overdue twice
   (`+IF(L11="",0,L11)+IF($L11="",0,$L11)`), so balances snowball (one shows ₹2,55,000 owed
   on ₹17,000 rent). Likely cause: the script's formula repair checks for `$L11` only, so
   rows that already had `L11` got a second copy.
2. **Water missing from Total Due:** on some tabs the Total Due formula leaves out the
   Water Bill column.
3. **Status says Paid for any payment:** Status only checks that Paid Date is filled, so a
   part payment, or a date with no amount, shows `Paid` while Overdue Amount is non-zero.
4. **Paid Date in mixed formats:** real dates, dates with a time, and text like
   `16/08/2026`. Several look like day and month were swapped (e.g. January for an August
   bill).
5. **Overdue Amount typed over:** a few rows have `0` typed in instead of the formula.
6. **History changes with current rates:** Rent (`=$C$4`) and electricity (`× $C$6`) read
   the tenant's current values, so changing the rent or rate rewrites every past month.
7. **Placeholder notes:** values like `none` and `None` mean empty.

## How the script works today

`onPaidDateEditV2` runs from an **installable on-edit trigger**. It is not an API: nothing
outside the spreadsheet can call it.

- When a Paid Date is entered, or the Email Trigger box is ticked, it builds an HTML
  receipt, converts it to PDF, and emails it to the owners in `CONFIG.recipientEmails` (not to
  the tenant).
- **Receipt number:** `RCP-<flat>-<yyyyMM>`, so one receipt per tenant per month.
- **Duplicate guard:** a Document Property keyed by `<sheet>!row<n>` stops a second email;
  clearing Paid Date resets it.
- **Logging:** every outcome goes to the `Email Log` tab, plus a failure-alert email.
- **One-off maintenance helpers** (already run on the live sheet): `previewMigration` /
  `runMigration` added Total Paid and Overdue Amount; `diagnoseHeaders` and
  `previewFormulaRepair` / `runFormulaRepair` fixed formulas after hand edits.

### Problems in the script

- **Wrong amount in the email body:** the email says "Amount Paid" but prints Total Due
  (`inr_(total)`). The PDF itself correctly uses Total Paid.
- **One receipt per month:** with several payments per bill (Phase 7), each payment needs its
  own receipt number.
- **Duplicate guard tied to row numbers:** inserting, deleting or sorting rows points
  the guard at the wrong month.
- **Personal details hard-coded in `CONFIG`:** owner emails, phone number and address.
  *Done in the repo copy:* they're read from Script Properties now; the live project still
  has them until the first `clasp push`.
- **User text not escaped in the receipt HTML:** tenant name and notes go into the HTML
  unescaped. Low risk, since only the owners edit the sheet, but escape them.
- **Stale comments:** the comments still mention column J for re-sends; the column is now
  found next to Notes.

## How the sheet maps to the app

| Spreadsheet | App (Phase 7) | Gap |
|---|---|---|
| Tenant tab details | `Tenant` | need a stable `id` (tab names change); mobile → E.164; due day → number; flat number → string without `.0` |
| Aadhaar, Breakdown | — | **don't import Aadhaar.** Breakdown could become rent + maintenance fields later |
| Monthly row: Month, Rent, Units, Rate, Water | `RentEntry` (bill) | the sheet's rent and rate are *current* values, not historical; copy the values shown at import time |
| Total Paid + Paid Date | `Payment` | one per month today. Import as one payment, like the v1 → v2 migration (`legacy-payment:<entryId>`) |
| Total Due with carry-forward | derived | the app's bill holds **only this month's charges**. Strip the carry-forward, or the debt is counted twice |
| Overdue Amount | derived | not stored in the app |
| Status: Paid / Unpaid / Overdue | `PaymentStatus`: paid / partially_paid / unpaid | the app has no "Overdue" (past due day) and the sheet has no "Partially paid" |
| Email Trigger, Email Log | — | belongs to the receipt feature (Phase 8) |

Product decisions this raises (the app doesn't do these yet):

- **Carry-forward balances:** show what a tenant owes across months (the sum of outstanding
  bills) rather than folding last month into this month's total.
- **Overdue status:** unpaid or part-paid after the rent due day.
- **Maintenance:** a separate charge, or part of rent.
- **Receipts:** Phase 8 receipts are per payment, so the reference needs to be unique per
  payment, not per month.

## Changes needed for the app to use it

The app talks to external systems only through `services/` and returns its own types (see
CLAUDE.md). Two ways to connect:

1. **Sheets as the database:** restructure into normalised tabs (`Tenants`, `Bills`,
   `Payments`, each with an ID column, no formulas the app relies on) and add an Apps Script
   web app (`doGet` / `doPost`) as the API.
2. **The app's backend as the source of truth (recommended):** e.g. Firestore alongside the
   planned Firebase auth, with the spreadsheet kept as a read-only export for the owners.
   Formulas, hand edits and per-tenant tabs stay a reporting concern.

Either way, the API has to do what the app already does locally:

- **Validate on the server:** one bill per tenant per month; payments > 0 with at most two
  decimals, no future dates, never above the outstanding amount. Browser checks are UX only.
- **Integer paise** for sums and comparisons.
- **Atomic writes:** `LockService` around every read → check → write, which removes the
  current "one active tab" assumption.
- **Idempotent payment IDs:** the app sends one ID per submission and retries with it; the
  server rejects or returns an ID it already has.
- **Dates as `YYYY-MM-DD` strings** in the Asia/Kolkata time zone, never `Date` objects
  crossing the API.
- **Real authentication:** a web app deployed for "Anyone" is public. Verify the caller (e.g.
  a Firebase ID token) before any tenant data is behind it. The current mock login is not
  authentication.
- **CORS:** Apps Script web apps redirect responses and don't answer preflight requests.
  Send POST bodies as `text/plain` JSON.
- **Receipt emails** move to a per-payment trigger (after `addPayment` succeeds), keyed by
  payment ID instead of sheet row.

## The script in the repo

The script lives in [`google-api/`](../google-api/README.md), split into files, with personal
details read from Script Properties and the script ID kept in the untracked `.clasp.json`. It's
a baseline copy of what runs today; the problems above are fixed in separate changes. The
README covers Script Properties, the first `clasp push` and the day-to-day workflow.

## Checklist for that phase

- [ ] Choose: Sheets as the database, or a backend with a sheet export
- [ ] Fix the data problems above (double carry-forward, missing water, text and swapped dates, typed-over formulas)
- [ ] Decide on carry-forward balances, Overdue status and maintenance in the app
- [ ] Give tenants, bills and payments stable IDs
- [ ] Import: copy rent and rate as historical values, strip carry-forward, one payment per paid month, normalise phone numbers, skip Aadhaar
- [x] Script in `google-api/`, with `CONFIG` details moved to Script Properties
- [ ] Script: fix the email "Amount Paid", per-payment receipt numbers, guard keyed by payment ID
- [ ] Server-side validation, `LockService`, idempotent payment IDs, authentication
- [ ] `tenantService` and a ledger service in `services/`, with tests against mocked responses
- [ ] Async loading in the stores (localStorage is synchronous today)
- [ ] Update CLAUDE.md "Current state"
