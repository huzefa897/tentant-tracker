# Messaging

Messaging is the app texting tenants by itself: a **Rent Due Reminder** when a month's rent falls due and again a week later if it's still owed, and later a **Payment Message** when a payment is recorded. There's no screen for sending messages by hand. It's built in steps: this doc says what exists today, and [messaging-roadmap.md](messaging-roadmap.md) what's still to come.

## Terms

Use these words, in code, admin, docs and PRs. Not "notification", "alert" or "payment reminder", and "SMS" only for the channel.

| Term                   | Means                                                                                           | In code                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Messaging**          | The whole feature                                                                               | the `messaging` app, this doc                                    |
| **Message**            | One SMS sent (or attempted) to one tenant                                                       | `Message`                                                        |
| **Message type**       | What a message is for                                                                           | `MessageType`                                                    |
| **Rent Due Reminder**  | Rent is due, or still owed a week later                                                         | `MessageType.RENT_DUE_REMINDER`                                  |
| **Payment Message**    | A recorded payment, confirmed to the tenant                                                     | `MessageType.PAYMENT_MESSAGE`                                    |
| **Reminder stage**     | Which send of a Rent Due Reminder: **Due** (on the due date) or **Follow-up** (7 days after it) | `ReminderStage.DUE`, `ReminderStage.FOLLOW_UP`                   |
| **Reminder item**      | One month at one stage covered by a Rent Due Reminder; at most one per month and stage          | `RentDueReminderItem`                                            |
| **Messaging settings** | A property's own settings: on or off, time zone, send time, when reminders start                | `PropertyMessagingSettings`                                      |
| **Message status**     | `queued`, `sent`, `failed`, `unknown`, `skipped`                                                | `MessageStatus`                                                  |
| **Channel**            | How a message is delivered; only SMS                                                            | `Channel.SMS`                                                    |
| **Sender**             | What delivers a message on a channel                                                            | `MessageSender`: `TextBeeSender`, `FakeSender`, `DisabledSender` |

## Where it lives

The `messaging` app (`backend/messaging/`) owns everything here. It depends on `properties` and `billing` (rental periods and what's owed); neither of them ever imports it. Later, a payment reaches messaging through a signal `billing` sends, so `billing` never knows messaging exists.

## Turning it on

Each property is turned on and off on its own, in admin; there's no switch for the whole deployment. Only an environment with a provider's credentials can send (see [Providers](#providers)): set them in production only, never in development, CI, a trial deploy or a database restored from a backup, which hold real tenants' numbers and properties with messaging on.

- **A property's messaging settings**, edited in the **Messaging** section of the property's own admin page, one row per property, keyed by it (`PropertyMessagingSettings`, a one-to-one beside `Property` rather than columns on it). A property without a row has messaging off (`PropertyMessagingSettings.for_property` returns unsaved defaults). The row holds:
  - **Send messages** (`enabled`).
  - **Provider** (`provider`, default TextBee): who sends its messages, picked from the registered providers ([Providers](#providers)) and checked on save. Beside it, **Provider set up** says whether this server has that provider's credentials (`Ready`, or which settings are missing); the credentials themselves are never in admin.
  - **Time zone** (`time_zone`, default `Asia/Kolkata`): a standard (IANA) name, picked from a list in admin and checked on save. It's a name, never an offset, so daylight saving is followed.
  - **Send time** (`send_time`, default 11:30), in that time zone.
  - **Reminders start** (`reminders_start`): Rent Due Reminders only for months due on or after it, so turning messaging on never texts tenants about older arrears. Required to turn it on (model validation, and a database check constraint).
  - Saving a property with its Messaging section untouched creates no row. That section has no delete: messaging is turned off with **Send messages**, which keeps the rest for turning it back on.
  - **Messaging > Property messaging settings** lists every property's settings (filter by on or off) to see which are sending. Deleting a row there turns messaging off and forgets its settings. The property is fixed once saved; deleting the property deletes its row.
  - The section is added to the property admin from `messaging/admin.py`, so `properties` still never imports messaging.

## Time and time zones

Messaging works out "today" and "is it time to send" in each property's own time zone (`PropertyMessagingSettings.local_date`, `send_time_reached`), never the server's or `settings.TIME_ZONE`. The current time comes from a `Clock` passed in (`messaging/clock.py`: `SystemClock`, and `FixedClock` for tests), so tests fix the moment instead of patching it.

Each run handles every property whose send time has come in its own zone, judged at one moment for the whole run: 11:30 in India, and a property elsewhere needs only its setting. Runs are hourly ([Running it](#running-it)); a late run sends late, and a second run finds the work done.

The rest of the app (the dashboard, bills, tenancy status) still uses `properties.models.business_date()`, which is India's date. Until that moves to each property's time zone, keep real properties' messaging on `Asia/Kolkata`, so a reminder and the dashboard agree on what's due. Zone names come from the `tzdata` package where the system has none (the slim production image), so they never depend on the server.

## Rent Due Reminders

Worked out by `messaging/policy.py` (`reminders_due`), a pure function: no database, no clock. For each **current** tenancy (ended and future ones are left out, with nothing recorded), each month that is:

- **still owed**, by billing's own definition (`RentalPeriod.objects.owing()`, the dashboard's; read in `messaging/owed.py`): a month without a bill is owed, since payments need a bill; a month marked not owed and a void bill don't count; reversed payments don't count; a part-paid month is still owed;
- **due** (its due date is today at the property or earlier), and fell due on or after the property's **reminders start**,

is at the **Due** stage from its due date until 6 days after it, and at the **Follow-up** stage from 7 days after its due date on (`FOLLOW_UP_AFTER_DAYS`), counted from the due date and whether or not the Due message went out. Each month gets each stage once, ever. A run that missed a whole week sends only the Follow-up, never both stages of one month. Rental periods are created by their reads, so the runner creates any that are due first (`ensure_property_periods`), as the dashboard does.

**One message per tenancy** lists all its months (`messaging/composer.py`), oldest first:

- one month, Due: _"Hi Ali, your rent for November 2026 is now due. Please arrange payment at your earliest convenience. Thank you."_
- one month, Follow-up: _"Hi Ali, this is a reminder that your November 2026 rent remains unpaid. Please arrange payment or contact us if you've already paid. Thank you."_
- several: _"Hi Ali, your rent for October 2026 (overdue) and November 2026 (due) is unpaid. Please arrange payment or contact us if you've already paid. Thank you."_

The name is the tenancy's, as written. The text is plain ASCII: one character outside the GSM alphabet (a ₹, a curly quote) makes every part of an SMS 70 characters instead of 160.

## Sending safely

`messaging/runner.py` (`MessageRunner`), per tenancy:

1. **Reserve.** Lock the months' rental periods, check again that they're still owed and not reminded about yet, then create a `queued` **message** and one **reminder item** per month and stage (`RentDueReminderItem`, unique on rental period and stage), and commit. Two runs at once: the second waits on the lock, then finds them reminded; the unique constraint is the last guard.
2. **Send**, outside any transaction, then record `sent`, `failed` or `unknown` with the provider's message id and a short reason. A timeout, a lost answer or a sender that raises is `unknown`, never `failed`: it may have gone. `queued` (the process stopped) and `unknown` are never sent again by themselves, since their months are reserved.

- A number that can't be texted (not a valid number for the countries `accounts/phone.py` allows) is **skipped**: recorded once a day per tenancy (`message_skipped_once_a_day`) with the reason, and nothing reserved, so the reminder goes out once the number is fixed.
- A failure for one tenancy, or one property (a time zone no longer in the database, say), is recorded on the run and never stops the others. Messaging never writes to bills or payments.
- **The property's provider isn't set up here** (no credentials, so `DisabledSender`): the run works out that property's messages and counts them as planned, reserves and sends nothing, and records why in its errors, so the months are still due once the credentials are set.
- A message keeps the number and text **as sent**, so a later change to the tenancy never rewrites one.

## Running it

`python manage.py send_messages` runs it once (`--dry-run` to list what it would send, saving nothing but the run's record). It prints flats, tenancy ids and months, never names or numbers, since its output can end up in logs. Safe to run again at any time: nothing is sent twice.

**Every hour**, [cron-job.org](https://cron-job.org) calls `POST /api/v1/messaging/run/` (`messaging/views.py`), which starts the same run (recorded with the trigger `schedule`). Hourly because each property sends at its own time in its own zone, and a run that's late or missed is caught up the next hour. Setting it up: [deployment.md](deployment.md#messaging).

- **Its own token, not a person's:** it needs `Authorization: Bearer <MESSAGING_RUN_TOKEN>`, compared in constant time, and never reads a Firebase token. Without the setting it answers 404; with a wrong token, 403. The token must be at least 32 characters, or the app doesn't start.
- **Limited** to 12 requests an hour per address (`DJANGO_THROTTLE_MESSAGING_RUN`), counted before the token is checked.
- **Answers counts only** (`run`, `dryRun`, `propertiesChecked`, `planned`, `sent`, `failed`, `unknown`, `skipped`, `errors`, `stoppedEarly`), never names, numbers or text.
- **A time budget:** a request must finish within Gunicorn's 30 seconds, and a send can take 10, so the run starts no new message after 15 seconds (`MESSAGING_RUN_TIME_BUDGET`). What's left was never reserved, so the next run sends it; the run is marked **stopped early**. The command has no budget.

## Sent by hand

Besides the runs, an owner or manager can text a tenant a reminder about one bill from its details page (**Send SMS**, beside Void bill). `messaging/manual.py` (`send_bill_reminder`), reached by `POST /api/v1/properties/{id}/tenancies/{id}/entries/{id}/reminder/`:

- **Who:** `Capability.SEND_MESSAGES` (owners and managers); anyone else gets 403, someone without access to the property 404. The app shows the button only where `GET /api/v1/properties/{id}/messaging/` says `enabled` (messaging on), `ready` (its provider is set up on this server) and `canSend` (the role); the endpoint checks all of it again.
- **When it sends nothing** it answers 409 with a `code`: `messaging_off`, `provider_not_set_up`, `entry_void`, `entry_paid` (nothing outstanding), `no_rental_period`, `number_untextable`, or `already_sent_today`.
- **One a day per bill.** Inside a transaction it locks the bill's rental period (what the runs lock), re-reads the bill, and refuses when a reminder sent by hand for that month today hasn't failed. A `failed` one can be sent again; a `queued` or `unknown` one can't, since it may have gone. So retrying after no answer never texts twice.
- **Reserve, then send**, like a run: a `queued` message with one reminder item at the stage **Sent by hand** (`ReminderStage.MANUAL`) and `sent_by` (who sent it), committed, then sent outside the transaction (`runner.deliver`). It answers 201 with `status` (`sent`, `failed` or `unknown`), a short `reason` and `sentAt`.
- **It never counts as the Due or Follow-up**, which still go out by themselves: the one-per-month constraint covers only the automatic stages. It's in Messaging > Messages like the rest, with its stage.
- **The text** is about that one month, from what's outstanding on the bill and its due date at the property: _"Hi Ali, your September 2026 rent (Rs. 4,712.50 outstanding) is overdue. Please arrange payment or contact us if you've already paid. Thank you."_ Before the due date it says "a reminder that your … is due on 11 November", on it "is due today", and with no due date "is unpaid".

## History in admin

Both read-only: nothing is added, edited or deleted there, so the record stays what the runner wrote.

- **Messaging > Messages**: every message, newest first: when, property, tenant and flat, type, months and stages, status and reason, provider, and the number's last four digits (the full number and the text are on the message's own page, with its months). Filters for status, type, property and date; search by tenant name or flat. Kept for good.
- **Messaging > Messaging runs**: one row per run (`MessagingRun`): when it started and finished, what started it, whether it was a dry run, properties checked, and how many messages were planned, sent, failed, unknown and skipped, with any errors (by property or tenancy id, never a number). A quiet day still shows the job ran; a run with no finish time stopped part way. Kept for 90 days (`RUN_RETENTION_DAYS`), deleted by later runs; their messages are kept.

## Providers

`messaging/senders/` has the interface (`base.py`), `DisabledSender`, `FakeSender` and [`TextBeeSender`](#textbee), and the one HTTP call senders make (`http.py`: the standard library's `urllib`, behind a seam tests fake). Each property picks its provider in admin, from the **provider registry** (`providers.py`), which builds its sender. Messaging works with any SMS provider: TextBee is the first, and adding another means one new sender class, its settings and one `registry.register(...)`, with no change to reminders, messages or their records; switching a property is a change in admin. For every sender:

- **One interface.** `MessageSender.send(to, body) -> SendResult`, where `to` is an E.164 number and the result is the app's own: an outcome (`sent`, `failed` or `unknown`), the provider's message id when it gave one, and a short reason. Nothing else in messaging imports a provider's code or knows its URLs, fields or error codes.
- **The sender turns the provider's answers into outcomes.** An accepted request is `sent`, a refusal `failed`, and a timeout, a dropped connection or an answer it can't read `unknown`, never `failed`: the message may have gone. It never raises a provider's or HTTP library's error to its caller.
- **Chosen per property, credentials per server.** The property's settings name the provider (a choice from `registry.choices()`, validated, never frozen into a migration); `registry.sender_for(name)` builds its sender from the environment. Credentials stay in the environment, never the database, so a restored backup or a developer's machine can't text anyone: without them (or for a name no longer registered) it gives a `DisabledSender` saying what's missing, which sends nothing. Each provider's settings have its own prefix (`TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`), so two can be set side by side while switching. Tests clear every provider's credentials (`config/test_runner.py`).
- **Each message records its provider** with the provider's message id, so old messages still read correctly after a switch, and delivery reports (if a provider sends them) are matched to the right one.
- **The same tests for every sender**: one shared set of tests (accepted, refused, timeout, unreadable answer, nothing logged but ids) runs against each sender with its HTTP calls faked, and the rest of messaging is tested with `FakeSender`.
- **Message text is the app's**, written by the composer, never a provider's template, so a switch doesn't change what tenants read.
- **Reasons are the sender's own words**, fixed per refusal, never the provider's answer, which could quote the number back. Logs carry the HTTP status and the exception's type only.

### TextBee

[TextBee](https://textbee.dev) sends SMS through an Android phone running its app, from that phone's SIM. Pick it in the property's settings, and set `TEXTBEE_API_KEY` (a secret) and `TEXTBEE_DEVICE_ID`, both from its dashboard; `TEXTBEE_BASE_URL` defaults to its API and must be https.

- One request per message: `POST /gateway/send-sms` with the key in `x-api-key` and `{"recipients": [to], "message", "deviceId"}`, 10 seconds' timeout, never retried (TextBee has no idempotency key, so a retry could text twice).
- A 200 with `data.success` is `sent`, recording `data.smsBatchId` as the provider's id. A 200 without success, and any 4xx, is `failed`: 400 (no enabled device, or the number or message rejected), 401 (the key), 403 (the account), 404 (the device), 429 (the plan's daily or monthly limit, 50 and 300 on the free plan). A timeout, a dropped connection, a 5xx or an answer it can't read is `unknown`.
- `sent` means TextBee accepted it, not that it was delivered: the phone has to be online. Delivery reports (its webhook, or looking up the batch) aren't used yet.

## What's next

The rest is planned step by step in [messaging-roadmap.md](messaging-roadmap.md), a temporary file deleted once messaging is built end to end.
