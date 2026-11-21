# Messaging roadmap

**Temporary.** The plan for building [Messaging](messaging.md) end to end. Each PR moves what it builds out of here and into `messaging.md`, which only ever describes what exists. Once the last step has shipped, delete this file and its link in `messaging.md`.

The terms (Message, Rent Due Reminder, Payment Message, Due, Follow-up, reminder item…) are defined in [messaging.md](messaging.md#terms). Use them.

## Status

| Step | What                                                                                                                                           | PR                                                          | Status      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------- |
| 1    | The `messaging` app, per-property settings, clock and time zones                                                                               | #89                                                         | In review   |
| 2a   | Rent Due Reminders without a provider: messages, reminder items, policy, composer, runner, sender interface, `send_messages`, history in admin | [#90](https://github.com/huzefa897/tentant-tracker/pull/90) | In review   |
| 2b   | The TextBee sender                                                                                                                             | [#91](https://github.com/huzefa897/tentant-tracker/pull/91) | In review   |
| 3    | Scheduling: the hourly trigger on Render, crontab on the single server                                                                         |                                                             | Not started |
| 4    | Payment Messages                                                                                                                               |                                                             | Not started |

Every step: based on `dev`, tests in the same PR, the checks in `CLAUDE.md`, and this table updated.

## Decisions (2026-11-21)

- **No backlog.** Reminders only for months due on or after the property's **reminders start**, set when messaging is turned on.
- **No deployment-wide switch** (no `MESSAGING_ENABLED`): each property is turned on in admin. Only an environment with a provider's credentials sends; production is the only one given them.
- **One message per tenancy per run**, listing all its months, never one per month.
- **Ended (and future) tenancies are left out**, including the last month of a postpaid tenancy, which falls due after it ends.
- **A number that can't be texted** is skipped without reserving anything, so the reminder goes out once it's fixed.
- **11:30 at the property**, in its own time zone, never fixed to India.
- **Provider agnostic**: the rules in [messaging.md](messaging.md#providers).
- **SOLID**: a pure policy, an injected clock and sender, new message types without changing the runner.
- Settings in a 1:1 table beside `Property`; `messaging` is its own app, and `properties` and `billing` never import it.

## Step 3: Scheduling

- Render's free plan has no cron jobs: a GitHub Actions schedule, every hour, calls a POST endpoint protected by a secret (compared in constant time) and rate limited, which runs the runner. Hourly because each property sends at its own time in its own time zone, and so a late or skipped GitHub run (they happen) is caught up the next hour; runs are safe to repeat. The API doesn't sleep (the uptime monitor keeps it awake, [deployment.md](deployment.md#render-and-supabase)); if it ever does, the call waits about a minute for it to wake.
- The single server: `send_messages` from crontab, every hour.
- **Pass `MESSAGING_PROVIDER` and the provider's settings through** to the backend: `compose.prod.yaml` gives it only the variables it lists, so one set only in `.env.production` never reaches Django (that leaves `DisabledSender`, which is safe). Never in `backend/.env.example` with real values, CI, or the restore scripts' environments. `render.yaml` (`sync: false` for the secret and the provider's credentials), `compose.prod.yaml`, `.env.production.example`, and `deployment.md` and `security.md` updated. Logs carry ids, never a full phone number.
- Scheduled workflows in a public repository stop after 60 days without activity: say how to notice and turn it back on.

## Step 4: Payment Messages

- `billing` sends its own `payment_recorded` signal inside `record_payment`'s transaction (and a bill created with an initial payment); a receiver in messaging saves a `queued` Payment Message there, one per payment (unique). Only that insert happens in the transaction; the message is sent after the commit, and the runner sends any left waiting.
- A retry with the same idempotency key adds none; a reversal or correction sends none; a failed send never affects the payment.
- The text says what was received and towards which month, never that it's settled when it isn't: _"Hi Ali, we've received your payment of Rs. 12,000 towards November 2026 rent. Thank you."_
- Reminders stop by themselves once a month is paid, since the policy checks it.

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
