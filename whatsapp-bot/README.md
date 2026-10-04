# Rent bot (WhatsApp)

A WhatsApp Cloud API webhook, deployed as an Apps Script web app, that lets the owners record
a tenant's monthly electricity units, water bill and payment in the TenantTracker spreadsheet
by chatting with it. It's expected to be retired once the app takes over.

It's a **separate Apps Script project** from [`google-api/`](../google-api/README.md): a
standalone web app that opens the spreadsheet by ID. The two projects don't share a global
scope, which is why both can declare `CONFIG`. Receipts the bot asks for are sent by
`google-api/src/ReceiptQueue.gs`.

> **This repository is public.** Never commit the spreadsheet ID, access tokens, phone numbers
> or tenant data. They live in **Script Properties**; the script ID lives in the untracked
> `.clasp.json`.

## Script Properties

Set these in the Apps Script editor: **Project Settings → Script Properties**. Then run
`testWhatsAppConfig()`: it logs which are set, never their values.

| Key | Value |
|---|---|
| `SPREADSHEET_ID` | The live TenantTracker spreadsheet's ID (from its URL) |
| `WA_ACCESS_TOKEN` | WhatsApp Cloud API access token |
| `WA_PHONE_NUMBER_ID` | The business number's phone number ID |
| `WA_VERIFY_TOKEN` | Any string; the same one goes in Meta's webhook settings |
| `WA_GRAPH_VERSION` | Graph API version, e.g. `v21.0` |
| `WA_WEBHOOK_SECRET` | A long random string. Calls without it in the URL are ignored |
| `WA_ALLOWED_NUMBERS` | Owners' WhatsApp numbers, comma-separated (`+91…` or digits only). Messages from anyone else are ignored |
| `TEST_SPREADSHEET_ID` | A **copy** of the spreadsheet, for the manual tests. They refuse to run without it |
| `DRY_RUN_OVERRIDE` | Set by the `rentcheck-safe-mode-on` / `-off` commands; don't set by hand |

Without `WA_WEBHOOK_SECRET` or `WA_ALLOWED_NUMBERS` the bot answers nobody: both fail closed.

## Setup

1. Set the Script Properties above.
2. Copy `.clasp.json.example` to `.clasp.json` (gitignored), set this project's `scriptId`,
   and `clasp push` from `whatsapp-bot/`. As with `google-api/`, add the project's
   `src/appsscript.json` manifest first: a push replaces it, and it holds the web app settings.
3. Deploy as a web app, then set Meta's webhook **callback URL** to the `/exec` URL with the
   secret appended: `https://script.google.com/macros/s/<deployment>/exec?key=<WA_WEBHOOK_SECRET>`.
4. In the `google-api` project, run `installReceiptQueueTrigger()` once, so receipts requested
   from WhatsApp are emailed.

## How a conversation goes

`rent.start` → tenant (if more than one) → month (previous, current or next) → overwrite
check if the row has data → electricity units → water bill (only if the tab has a Water Bill
column) → payment received? → paid date → amount → notes → email receipt? → confirm.
`rent.status`, `rent.cancel` and `hint` work at any point. Nothing is written until the final
"yes", and only while safe mode is off (`CONFIG.DRY_RUN` is `true` until
`rentcheck-safe-mode-off` is sent).

## Behaviour worth knowing

- **Only allowed numbers**, and only through the secret URL. Meta's test-number allow list
  limits who gets replies, not who can make the bot write.
- **Payments add up:** a payment is added to the month's Total Paid instead of replacing it.
  Answering "no" keeps what's recorded; the bot never clears a payment. Paid Date holds the
  latest payment's date. Correct mistakes in the sheet itself.
- **Re-checked at save time:** the month's row is found again by date (rows may have moved),
  and the save stops if that row changed after the user started.
- **Rolled back on failure:** if a write fails, the cells written so far are restored. If even
  that fails, the reply says so instead of claiming nothing changed.
- **Columns by header label**, as in `google-api/`. The save stops if a tab's Status formula
  checks a different column than the one labelled Paid Date (headers that were edited without
  the columns moving).
- **Receipts are queued**, not sent at once: the bot tags the row, and `google-api`'s trigger
  emails it within about 5 minutes. A script's edits can't fire the on-edit receipt trigger.
- **Sessions expire** after 30 minutes without a reply. Tenant and month numbers refer to the
  list the user was shown.
- **Input checks:** amounts > 0 with at most two decimals, `1,5` is rejected rather than read as
  15, paid dates can't be in the future, and dates are kept in the sheet's time zone.
- **One message at a time** (script lock), so quick replies or a redelivered message can't
  corrupt a session.

## Manual tests

Run from the editor; all of them use `TEST_SPREADSHEET_ID`, never the live sheet.

- `testWhatsAppConfig()`: which Script Properties are set.
- `testMessage()`: starts an entry and logs the first reply.
- `testOverwriteProtection()`: walks the overwrite confirmation (no, then yes) and restores
  the row.
