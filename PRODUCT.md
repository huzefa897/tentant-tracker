# Product

## Register

product

## Users

The owners and managers of one residential building in India (Saleem Towers), signed in by phone number. They use it as often for a quick check on a phone, at the building or on the move, as for the monthly accounts on a laptop. Tenants never sign in. The jobs: record each month's bill and the payments against it, issue receipts, and know at a glance who still owes money and how late it is.

## Product Purpose

Replaces the owners' Google Sheet with a ledger the backend keeps correct: bills, payments, reversals and receipts, with balances worked out by the server, never typed in. Success is opening the app and knowing, without doing sums, who owes what, what's overdue, what's due soon and which months have no bill yet, and trusting those figures enough to act on them.

## Brand Personality

Calm, precise, trustworthy: a well-kept account book. Numbers come first and are easy to read; the interface stays quiet so that what's late stands out. Plain, direct wording ("Overdue", "Due today", "Couldn't refresh"), never cheerful filler or alarm.

## Anti-references

- SaaS analytics dashboards: hero metrics, gradients, sparkline decoration, identical card grids.
- Spreadsheets dumped on screen: dense grids where every cell weighs the same.
- Collection-agency urgency: red everywhere, countdowns, guilt.
- Anything that shows a zero or an empty list when a load failed.

## Design Principles

- **The figures are the backend's.** Show what the server calculated and say what it's based on ("from recorded bills"); never imply more certainty than the data has.
- **Late is the only loud thing.** Colour and emphasis are reserved for overdue and due-today money; everything else stays neutral.
- **A failure is never a zero.** Errors keep what was last shown, with when it was from, and offer a retry.
- **Works one-handed and at a desk.** Every screen reads well on a phone first and uses the extra width on a laptop.
- **Say exactly what happened.** Short, literal labels and messages; no jargon or euphemism.

## Accessibility & Inclusion

WCAG 2.1 AA: text contrast ≥4.5:1, keyboard and screen-reader support, visible focus, errors announced inline (`role="alert"`), status never shown by colour alone (always a label), and no motion under `prefers-reduced-motion`.
