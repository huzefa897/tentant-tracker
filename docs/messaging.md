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

The `messaging` app (`backend/messaging/`) owns everything here. It depends on `properties` and `billing`; neither of them ever imports it. Later, a payment reaches messaging through a signal `billing` sends, so `billing` never knows messaging exists.

## Turning it on

Two switches, both off by default. Nothing is sent unless both are on:

- **`MESSAGING_ENABLED`** (environment, `backend/.env.example`): for the whole deployment.
- **A property's messaging settings**, edited in the **Messaging** section of the property's own admin page, one row per property, keyed by it (`PropertyMessagingSettings`, a one-to-one beside `Property` rather than columns on it). A property without a row has messaging off (`PropertyMessagingSettings.for_property` returns unsaved defaults). The row holds:
  - **Send messages** (`enabled`).
  - **Time zone** (`time_zone`, default `Asia/Kolkata`): a standard (IANA) name, picked from a list in admin and checked on save. It's a name, never an offset, so daylight saving is followed.
  - **Send time** (`send_time`, default 11:30), in that time zone.
  - **Reminders start** (`reminders_start`): Rent Due Reminders only for months due on or after it, so turning messaging on never texts tenants about older arrears. Required to turn it on (model validation, and a database check constraint).
  - Saving a property with its Messaging section untouched creates no row. That section has no delete: messaging is turned off with **Send messages**, which keeps the rest for turning it back on.
  - **Messaging > Property messaging settings** lists every property's settings (filter by on or off) to see which are sending. Deleting a row there turns messaging off and forgets its settings. The property is fixed once saved; deleting the property deletes its row.
  - The section is added to the property admin from `messaging/admin.py`, so `properties` still never imports messaging.

## Time and time zones

Messaging works out "today" and "is it time to send" in each property's own time zone (`PropertyMessagingSettings.local_date`, `send_time_reached`), never the server's or `settings.TIME_ZONE`. The current time comes from a `Clock` passed in (`messaging/clock.py`: `SystemClock`, and `FixedClock` for tests), so tests fix the moment instead of patching it.

The job will run every hour and send for each property whose send time has come in its own zone: 11:30 in India, and a property elsewhere needs only its setting. A late run sends late; a second run finds the work done.

The rest of the app (the dashboard, bills, tenancy status) still uses `properties.models.business_date()`, which is India's date. Until that moves to each property's time zone, keep real properties' messaging on `Asia/Kolkata`, so a reminder and the dashboard agree on what's due. Zone names come from the `tzdata` package where the system has none (the slim production image), so they never depend on the server.

## Providers

Senders arrive in step 2 of the [roadmap](messaging-roadmap.md); these rules are decided now, so each one follows them. Messaging works with any SMS provider: TextBee is the first, and changing to another means one new sender class and new settings, with no change to reminders, messages or their records. For every sender:

- **One interface.** `MessageSender.send(to, body) -> SendResult`, where `to` is an E.164 number and the result is the app's own: an outcome (`sent`, `failed` or `unknown`), the provider's message id when it gave one, and a short reason. Nothing else in messaging imports a provider's code or knows its URLs, fields or error codes.
- **The sender turns the provider's answers into outcomes.** An accepted request is `sent`, a refusal `failed`, and a timeout, a dropped connection or an answer it can't read `unknown`, never `failed`: the message may have gone. It never raises a provider's or HTTP library's error to its caller.
- **Chosen by a setting.** `MESSAGING_PROVIDER` (`textbee`, later others) picks the sender in one place, a small factory; `MESSAGING_ENABLED` off always gives `DisabledSender`, whatever the provider. Each provider's settings have its own prefix (`TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`), so two can be configured side by side while switching.
- **Each message records its provider** with the provider's message id, so old messages still read correctly after a switch, and delivery reports (if a provider sends them) are matched to the right one.
- **The same tests for every sender**: one shared set of tests (accepted, refused, timeout, unreadable answer, nothing logged but ids) runs against each sender with its HTTP calls faked, and the rest of messaging is tested with `FakeSender`.
- **Message text is the app's**, written by the composer, never a provider's template, so a switch doesn't change what tenants read.

## What's next

The rest is planned step by step in [messaging-roadmap.md](messaging-roadmap.md), a temporary file deleted once messaging is built end to end.
