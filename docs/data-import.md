# Importing existing data

Getting the records the owners already have into the production database once, without losing or duplicating any. After the import, **PostgreSQL is the only place records are kept**: the Sheet is kept unchanged as the recovery copy and nobody enters new months in it.

## What gets imported

| Source                                                                      | Decision                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Test tenants and bills in development databases and fakes                   | Never imported. Production starts empty.                                                                          |
| Bills saved in a browser before BE Phase 4 (`rent-tracker:rent-entries:v1`) | Not imported: test data from before the backend.                                                                  |
| **The owners' Google Sheet**                                                | **Imported** with the commands below: their real history.                                                         |
| Records already in production (made in the app)                             | Kept. The import never merges into them: a month that already has a bill is refused, so nothing is entered twice. |

## How it works

**The easy way: admin.** On the property's page in admin, **Import from Google Sheet** (superusers only) does it all on the server, in three steps on one page:

1. **Upload** the `.xlsx` (up to 5 MB). It's read in memory and never stored. It must be a real `.xlsx` (checked by its content), and one that unpacks to far more than a spreadsheet would is refused. The page shows the totals, any **problems** (nothing can be imported until they're fixed in the Sheet) and the warnings to **check** (step 3 below).
2. **Match each tab** to one of _this property's_ tenancies (never by name), or choose _Don't import this tab_, then **Check**: a dry run that shows what would be created and the reconciliation, and saves nothing.
3. **Import**: only offered after a clean check, and it imports exactly what was checked. Admin's history for the property records what was imported.

Between steps the converted Sheet travels in the page, signed for that property and admin, so it can't be altered, and it expires after an hour. Create the tenancies first (step 4 below) and take a backup (step 5). The steps below apply too, apart from copying files: the commands are the same import, for running by hand.

**By hand: two commands**, with a file you can read in between:

1. **`sheet_to_ledger`** (on your computer) converts the Sheet, downloaded as `.xlsx`, into a **ledger file** (JSON). It takes each month's own charges and payment and refuses anything it can't convert safely ([billing/sheet_ledger.py](../backend/billing/sheet_ledger.py)).
2. **`import_legacy_ledger`** (on the server) imports the ledger, using a **mapping file** that says which tenancy each tab belongs to ([billing/legacy_import.py](../backend/billing/legacy_import.py)).

From the Sheet:

- **Bills**: one per tenant tab and month, with that month's rent, units, the tab's electricity rate, water and notes. **Total Due and Overdue Amount are never read**: they add last month's balance (on some tabs twice), and the app works out balances from bills and payments itself. Months still in the future, or with no units and no payment yet, are left out.
- **Payments**: a month's Total Paid with its Paid Date, as one payment.
- **Receipts**: the one the Sheet's script emailed for each payment, with **its original reference** (`RCP-<flat>-<yyyyMM>`, which must be free within the property, as app references are) and the paid date as its issue date. The app doesn't issue a new receipt for it. Its contents are the imported bill and payment as they stood then; the emailed PDFs stay the originals.
- **Never**: Aadhaar numbers, phone numbers, deposits, the Email Log. Tenancies aren't created from the Sheet: you create them in admin, with their real details.

The import is **all or nothing**: it runs in one transaction, and if any record is refused, or the database doesn't match the ledger afterwards, nothing is kept. Each imported record is remembered (`LegacyRecord`, read-only in admin), so **running it again creates nothing twice**: it reports those records as already imported, imports only new ones, and refuses any that changed since.

## Steps

### 1. Freeze the Sheet

Agree a moment with the owners when they stop entering anything in the Sheet, until the import is done and checked. From then on, new months go into the app only.

### 2. Download it, and keep the original

Google Sheets > File > Download > Microsoft Excel (.xlsx). Keep this file **unchanged**, somewhere private (never in the repository: it holds tenants' personal details), as the recovery copy. Work on a copy.

### 3. Convert it (on your computer)

```bash
cd backend
pipenv install
pipenv run python manage.py sheet_to_ledger ~/private/TenantTracker.xlsx \
  --output ~/private/ledger.json --mapping-template ~/private/tenancy-map.json
```

It prints what it found (tenants, bills, payments, receipts, total billed and paid), then:

- **Problems**: rows it couldn't convert safely, with the tab and row. Nothing is written until they're fixed. Fix them **in the Sheet** (a working copy is fine), download again and rerun. The usual ones (see [google-sheets-integration.md](google-sheets-integration.md)):
  - _paid more than the month's own charges_: the Sheet let a payment cover several months; the app keeps each payment on its own month's bill. Move the part that paid other months into those months' Total Paid (with the right dates).
  - _Paid Date isn't a date_, _Rent Amount isn't more than 0_, _Electricity Charge isn't Units Used × a rate_: correct the cell.
  - _no 'Water Bill' column_ (or Rent Amount, Units Used, Total Paid, Paid Date): the tab's header is missing or misspelled. Correct the header in row 10; water is required even when it's often blank, so no bill quietly loses it.
- **Check these**: things it converted but you should look at, e.g. a paid date that looks like its day and month were swapped, or a month with a payment but no units. A tab whose Total Due, less last month's Overdue Amount, isn't the month's own charges (last month's balance added twice, water left out, an Overdue Amount typed over) gets one warning listing its rows: the ledger has the month's own charges, so those months' balances will differ from what the Sheet showed. Check them against the Sheet. A tab with no Total Due or Overdue Amount column can't be compared at all, and gets a warning saying so.

It writes only outside the repository (the files hold tenants' names and payments), and refuses a path inside it.

Read `ledger.json`: it's plain text, one entry per month.

### 4. Create the tenancies and fill in the mapping

In production admin, create each tenancy (flat, dates, rent, rate, deposit) so its dates cover every month in its tab. Then, in `tenancy-map.json`, put each tab's tenancy id next to it (open the tenancy in admin: the id is in the address, `…/tenancy/<id>/change/`):

```json
{
  "Tenant A": "6c1f…-tenancy-id",
  "Tenant B (flat 301)": "a93e…-tenancy-id"
}
```

Tabs are matched only through this file, never by name. A tenant with two flats has two tabs, each mapped to its own tenancy.

### 5. Back up, then try it

Copy the two files to the server, outside the repository, into a folder the container can read (`chmod 755` folder, `chmod 644` files; delete them after the import). Take a backup first (`scripts/backup-db.sh`). Then a dry run, which checks and reconciles everything and saves nothing:

```bash
docker compose --env-file .env.production -f compose.prod.yaml run --rm \
  -v /home/deploy/import:/import:ro backend \
  python manage.py import_legacy_ledger /import/ledger.json \
  --mapping /import/tenancy-map.json --imported-by <admin username> --dry-run
```

`--imported-by` is the username recorded as creating the records and issuing the receipts.

### 6. Import, and reconcile

Run the same command without `--dry-run`. It prints what it created and the reconciliation, which must all say `ok`:

| Check                           | Must be                                       |
| ------------------------------- | --------------------------------------------- |
| bills, payments, receipts       | the same count in the ledger and the database |
| total billed, total paid        | the same                                      |
| bills whose outstanding differs | 0                                             |

These compare the ledger with the database, so they catch an import gone wrong, or payments recorded in the app since an earlier run. They can't tell you the ledger matches the Sheet: that's step 3's warnings and your reading of `ledger.json`.

Then compare with what the converter printed in step 3, open a few tenants in the app (their bills, payments and receipts), and run `python manage.py ledger_summary` for the database's totals.

### 7. Switch over

PostgreSQL is now the authoritative copy. Tell the owners to enter everything in the app from now on, and stop using the Sheet for new entries (keep it, read-only). Delete the working files from the server and your computer; keep the original download and the ledger somewhere private.

## Running it again

Safe at any time: records already imported are reported, not created again. Use it if the import was interrupted or the Sheet gained months before the switch. If it says a record **changed since it was imported**, the Sheet was edited after the import. The import never overwrites what's there, and bills and payments can't be edited in admin: either keep what was imported (undo the edit in your working copy), or restore the backup from step 5 and import again.
