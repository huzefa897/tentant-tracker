# Messaging roadmap

**Temporary.** The plan for building [Messaging](messaging.md) end to end. Each PR moves what it builds out of here and into `messaging.md`, which only ever describes what exists. Once the last step has shipped, delete this file and its link in `messaging.md`.

The terms (Message, Rent Due Reminder, Payment Message, Due, Follow-up, reminder item…) are defined in [messaging.md](messaging.md#terms). Use them.

## Status

| Step | What                                                                                                                                           | PR                                                          | Status      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------- |
| 1    | The `messaging` app, per-property settings, clock and time zones                                                                               | #89                                                         | In review   |
| 2a   | Rent Due Reminders without a provider: messages, reminder items, policy, composer, runner, sender interface, `send_messages`, history in admin | [#90](https://github.com/huzefa897/tentant-tracker/pull/90) | In review   |
| 2b   | The TextBee sender                                                                                                                             | [#91](https://github.com/huzefa897/tentant-tracker/pull/91) | In review   |
| 3    | Scheduling: the run endpoint, called hourly by cron-job.org                                                                                    | [#92](https://github.com/huzefa897/tentant-tracker/pull/92) | In review   |
| —    | Send SMS by hand from the tenant page: every month owed, previewed first                                                                       | [#95](https://github.com/huzefa897/tentant-tracker/pull/95) | In review   |
| 4    | Payment Messages                                                                                                                               |                                                             | Not started |

Every step: based on `dev`, tests in the same PR, the checks in `CLAUDE.md`, and this table updated.

## Decisions (2026-11-21)

- **No backlog.** Reminders only for months due on or after the property's **reminders start**, set when messaging is turned on.
- **No deployment-wide switch** (no `MESSAGING_ENABLED`): each property is turned on in admin. Only an environment with a provider's credentials sends; production is the only one given them.
- **One message per tenancy per run**, listing all its months, never one per month.
- **Ended (and future) tenancies are left out**, including the last month of a postpaid tenancy, which falls due after it ends.
- **A number that can't be texted** is skipped without reserving anything, so the reminder goes out once it's fixed.
- **11:30 at the property**, in its own time zone, never fixed to India.
- **cron-job.org starts the runs, no task queue** (decided 2026-11-21). Django-Q2 (or Celery) needs a worker process of its own: a paid Render Background Worker, or squeezed beside Gunicorn in the free instance's 512 MB with nothing restarting it. Revisit on a paid plan, or if Payment Messages are too slow to send in the request; even then, never retry a send (a retry can text twice).
- **Provider agnostic**: the rules in [messaging.md](messaging.md#providers). Each property picks its provider in admin from a registry; credentials stay in the environment (decided 2026-11-21, replacing `MESSAGING_PROVIDER`).
- **SOLID**: a pure policy, an injected clock and sender, new message types without changing the runner.
- Settings in a 1:1 table beside `Property`; `messaging` is its own app, and `properties` and `billing` never import it.

## Step 4: Payment Messages

- `billing` sends its own `payment_recorded` signal inside `record_payment`'s transaction (and a bill created with an initial payment); a receiver in messaging saves a `queued` Payment Message there, one per payment (unique). Only that insert happens in the transaction; the message is sent after the commit, and the runner sends any left waiting.
- A retry with the same idempotency key adds none; a reversal or correction sends none; a failed send never affects the payment.
- The text says what was received and towards which month, never that it's settled when it isn't: _"Hi Ali, we've received your payment of Rs. 12,000 towards November 2026 rent. Thank you."_
- Reminders stop by themselves once a month is paid, since the policy checks it.

## Later: the property's time zone for the whole app

Not needed while every property is in India; do it before adding one that isn't. Messaging already follows the property's zone; the rest of the app doesn't yet.

- **The rule, already followed:** moments (sent, recorded, started) are stored in UTC (`USE_TZ`); local rules (11:30 each day, due on the 11th) are stored as local time plus an IANA zone and converted when checked, since a fixed UTC time drifts an hour with daylight saving. Dates and deadlines follow the **property's** zone, never the viewer's: an owner abroad sees the same overdue bills.
- **Today:** `business_date()` ([properties/models.py](../backend/properties/models.py)) is India's date for tenancy status, rental periods and the dashboard, from `TIME_ZONE = "Asia/Kolkata"`. Keep `TIME_ZONE` as it is: making it UTC changes no stored timestamp, only "today", which would lag India's from midnight to 05:30.
- **The change:** move `time_zone` from `PropertyMessagingSettings` onto `Property` (a data migration copies it; messaging reads the property's), and make `business_date(prop)` use it, passing the property everywhere it's called. Tests for a property outside India: a tenancy's status and a month's due date flip at that property's midnight.

## Acceptance tests

From the original spec; each is a test in the step that builds it, marked with its ID (`# TC-05`) in `backend/messaging/tests/`.

| ID    | Scenario                                    | Expected                                       | Step |
| ----- | ------------------------------------------- | ---------------------------------------------- | ---- |
| TC-01 | Due today, unpaid                           | Due message                                    | 2a   |
| TC-02 | Fully paid before the due date              | No message                                     | 2a   |
| TC-03 | Due, no bill                                | Due message                                    | 2a   |
| TC-04 | Part paid on the due date                   | Due message                                    | 2a   |
| TC-05 | Unpaid 7 days after the due date            | Follow-up                                      | 2a   |
| TC-06 | Paid 3 days after the due date              | No Follow-up                                   | 2a   |
| TC-07 | Fully paid on day 7 before the run          | No Follow-up                                   | 2a   |
| TC-08 | Still part paid on day 7                    | Follow-up                                      | 2a   |
| TC-09 | Two runs on the same day                    | No second message                              | 2a   |
| TC-10 | Number can't be texted                      | Skipped, reason recorded, sent once fixed      | 2a   |
| TC-11 | Provider refuses                            | `failed`, billing unaffected                   | 2a   |
| TC-12 | Provider times out                          | `unknown`, not retried                         | 2a   |
| TC-13 | Due message failed, still unpaid on day 7   | Follow-up                                      | 2a   |
| TC-14 | Two tenants due the same day                | Both sent, independently                       | 2a   |
| TC-15 | Tenancy ended before the due date           | No message                                     | 2a   |
| TC-16 | No provider configured                      | No provider request                            | 2a   |
| TC-17 | Run late or a day missed                    | Catches up (Due within 6 days, then Follow-up) | 2a   |
| —     | Months due before reminders start           | No message                                     | 2a   |
| —     | Several months owed                         | One message listing them                       | 2a   |
| —     | Before the send time in the property's zone | Nothing sent yet                               | 2a   |
| TC-18 | Payment recorded                            | Payment Message                                | 4    |
| TC-19 | Payment refused                             | No message                                     | 4    |
| TC-20 | Same payment request twice                  | One message                                    | 4    |
| TC-21 | Part payment                                | Amount received, not "settled"                 | 4    |
| TC-22 | Payment reversed                            | No message                                     | 4    |
| TC-23 | Provider down                               | Payment still recorded                         | 4    |
| TC-24 | Payment settles the month                   | No more reminders                              | 4    |
| TC-25 | Payment corrected or reconciled             | No extra message                               | 4    |
