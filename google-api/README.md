# TenantTracker Apps Script

The Google Apps Script attached to the owners' TenantTracker spreadsheet. When a **Paid Date**
is entered on a tenant tab, it emails a PDF rent receipt to the owners and logs what happened
to the sheet's `Email Log` tab.

This is the source of truth for the script: change it here, review it in a PR, then push it to
Apps Script. How it fits with the app is in
[`docs/google-sheets-integration.md`](../docs/google-sheets-integration.md).

> **This repository is public.** Never commit email addresses, phone numbers, addresses,
> the script ID, sheet IDs or tenant data. Personal details live in **Script Properties**;
> the script ID lives in the untracked `.clasp.json`.

## Files

| File | What it does |
|---|---|
| `src/Config.gs` | `CONFIG`, read from Script Properties; `checkConfig()`. The **only** file that may declare `CONFIG` |
| `src/Receipts.gs` | The on-edit trigger (`onPaidDateEditV2`), receipt PDF and email, sheet helpers, `resetActiveRowReceipt()`, `checkMailQuota()` |
| `src/Logging.gs` | `Email Log` tab writer and the failure-alert email |
| `src/Maintenance.gs` | One-off helpers already run on the live sheet: column migration, header diagnosis, formula repair |
| `src/appsscript.json` | Project manifest (not committed yet; see first-time setup) |

Apps Script loads every file into **one shared global scope**, so a name declared in two files
clashes. Keep top-level declarations unique across `src/`.

## Script Properties

Set these in the Apps Script editor: **Project Settings → Script Properties**. Then run
`checkConfig()` from the editor; it logs which keys are set or missing, never their values.

| Key | Value | Required |
|---|---|---|
| `RECIPIENT_EMAILS` | Owners who get every receipt, comma-separated | yes: receipts fail without it |
| `ALERT_EMAIL` | Where failures are reported | no: unset disables alerts |
| `ISSUER_MANAGER_NAME` | Printed as "Received By / Property Manager" | no |
| `ISSUER_BUILDING_NAME` | Building name on the receipt | no |
| `ISSUER_ADDRESS` | Address lines separated by `\|`, e.g. `Line 1\|Line 2\|City – PIN` | no |
| `ISSUER_CONTACT` | Contact number on the receipt | no |
| `ISSUER_EMAIL` | Contact email on the receipt | no |

Optional keys left unset are simply left off the receipt.

## First-time setup

Before the repo version replaces what's running in Apps Script:

1. **Set the Script Properties** above, using the values from the current `CONFIG` in the
   editor. Run `checkConfig()` and confirm nothing required is missing.
2. **Install [clasp](https://github.com/google/clasp)** and sign in:
   ```bash
   npm install -g @google/clasp
   ```
   ```bash
   clasp login
   ```
   Also enable the Apps Script API at <https://script.google.com/home/usersettings>.
3. **Point clasp at the project.** Copy `.clasp.json.example` to `.clasp.json` (gitignored)
   and set `scriptId` from **Project Settings → IDs** in the editor.
4. **Add the manifest.** In the editor, turn on **Project Settings → Show "appsscript.json"
   manifest file in editor**, copy its contents into `src/appsscript.json`, check it holds
   nothing personal, and commit it. Pushing replaces the project's manifest, including its
   time zone, so it must match what's there now.
5. **Push** from `google-api/`:
   ```bash
   clasp push
   ```
   `clasp push` **replaces every file** in the Apps Script project with the files in `src/`,
   so the old single file holding the personal `CONFIG` is removed.
6. **Check the trigger** still exists: **Triggers** → `onPaidDateEditV2`, *From spreadsheet*,
   *On edit*. It's installable, not a simple `onEdit`, because sending email needs
   authorisation.
7. **Test** with `CONFIG.dryRun = true` on a test tab, then set it back to `false`.

## Day to day

- Edit the files here, open a PR, and once it's merged run `clasp push` from `google-api/`.
- Don't edit in the Apps Script editor; the next push overwrites it. If someone has, run
  `clasp pull` first and commit the change after checking it for personal details.
- `clasp pull` writes into `src/`. **Check `git diff` before committing**: a pull can bring
  back hard-coded details someone typed into the editor.

## Known issues

These are tracked in the integration doc and are deliberately **not** fixed in this baseline
copy:

- The email body's "Amount Paid" shows Total Due; the PDF is correct.
- One receipt number per tenant per month (`RCP-<flat>-<yyyyMM>`), not per payment.
- The "already emailed" guard is keyed by sheet row, so inserting or sorting rows breaks it.
- Tenant names and notes go into the receipt HTML unescaped.
- `repairFormulas_` looks for the carry-forward term with `$` (`$L11`). Rows that already
  had it without `$` (`L11`) got it appended a second time, which double-counts the
  carry-forward.
