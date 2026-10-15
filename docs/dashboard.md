# Property dashboard

The dashboard answers, for the selected property: who owes money, how much of it is late, what's due soon, and which occupied months have no bill. Due dates come from [rent-entries.md](rent-entries.md#due-dates).

## What counts

- **Recorded bills only.** Totals come from active bills and the payments that weren't reversed; void bills count for nothing. A month with no bill adds nothing: it's listed under [missing bills](#missing-bills) instead, and totals are labelled as from recorded bills.
- **One definition** of a bill's amounts in SQL (`billing/models.py`: `effective_paid_sql`, `total_due_sql`, `outstanding_sql`), used by bill lists, their filters (`RentEntry.objects.with_amounts()`, `.owing()`) and the dashboard. Payments are summed in a subquery per bill, never joined, so adding up bills never counts a bill once per payment.
- **Due windows**, on today in India (`business_date()`, once per request): **overdue** (due date before today), **due today**, **due next 7 days** (tomorrow to a week from today). They're parts of what's **outstanding**, never amounts to add to it. A bill without a due date (from before due dates, until `fill_bill_due_dates` runs) counts towards outstanding and is reported apart as **without due date**, never as on time.
- Everything is summed in the database across the whole property before paging (`billing/dashboard.py`); the list's filters never change the summary.

## API

Read-only, for anyone with access to the property (`properties_for_user`; another property 404s). Money is a decimal string.

- `GET /api/v1/properties/{id}/dashboard/summary/`: `asOfDate`, `generatedAt`, `currency`, `outstandingAmount`, `overdueAmount`, `dueTodayAmount`, `dueNext7DaysAmount`, `withoutDueDateAmount`, `pendingTenancyCount`, `overdueTenancyCount`.
- `GET .../dashboard/pending-tenancies/`: one row per **tenancy** that owes money (ended ones too; grouped by tenancy id, so a flat's earlier and later occupants stay apart): `tenancyId`, `name`, `flatNumber`, `tenancyStatus`, the five amounts, `pendingBillCount`, `oldestDueDate`, `oldestOverdueDate`. Overdue tenancies first, oldest overdue first, then the oldest due date, name and id. `?due_status=all|overdue|due_today|due_next_7_days` keeps tenancies with money in that window; `?search=` matches name or flat (100 characters at most); 20 a page (`?page=`). Its query count doesn't grow with bills or payments (tested).
- **A tenancy's unpaid bills:** the bills list takes `?balance=outstanding` (active bills with money still to pay), with the rest of its filters and paging ([rent-entries.md](rent-entries.md)).

## Missing bills

`GET .../dashboard/missing-bills/?billing_month=YYYY-MM`: tenancies occupying any day of the month with no **active** bill for it (a month whose bill was voided is missing again), each with `tenancyId`, `name`, `flatNumber`, `tenancyStatus` and `rentAmount`. Without a month it's last month when the property is postpaid (its electricity is read after it ends) and this month when prepaid. Nothing is estimated for them.
