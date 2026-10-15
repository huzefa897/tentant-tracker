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

## App

After signing in and choosing a property, the dashboard (`DashboardView`) opens on **Pending payments**. Choosing a tenant in the toolbar search shows their details as before, with **Pending payments** to go back.

- **Data:** `services/dashboard.service.ts` validates each response (money as two-decimal strings, dates, counts, tenancy statuses) and maps it to `types/dashboard.ts`. `stores/dashboard.ts` holds the summary, one page of pending tenancies for one due filter, and one month's missing bills. It resets as soon as the property changes.
- **Refreshing:** the dashboard refreshes whenever Pending payments is shown: on opening it, on coming back from a payment, reversal, new or corrected bill, after another property is chosen, and from **Refresh**. A refresh loads all three parts together and replaces them only when all three arrive, so the screen never mixes two moments. A refresh while one is running waits for it instead of sending the requests again. **Updated 2 minutes ago** moves on by itself.
- **Failures:** a failed first load is an error with Try again (auto-retried for passing errors), never zeros. A failed refresh keeps everything shown and says **Couldn’t refresh. Showing data from 6:30 pm.**; nothing signs the user out. Changing the filter, page or missing-bills month reloads only that part, with skeleton rows in its place and its own error and Try again.
- **Summary** (`DashboardSummary`): Outstanding as the main figure, then "Of which" overdue (red when there is any), due today (amber when there is any) and due in the next 7 days, so they read as parts of it rather than amounts to add. It says how many tenants owe, that it's from recorded bills, and how much is on bills without a due date.
- **Who owes** (`DueFilterGroup`, `PendingTenancyList`): All pending, Overdue, Due today, Next 7 days (toggle buttons, `aria-pressed`). Rows show the tenant and flat (ended tenancies say so), overdue, outstanding and the oldest unpaid due date, as a table from `md` up and as stacked rows on phones. Pages of 20. **View bills** opens the tenant's bill history filtered to **Outstanding** (`?status=outstanding`, the bills list's `?balance=outstanding`), where payments are recorded against the chosen bill as usual. Nothing is allocated across months. The toolbar search already finds any tenant, so the list has no search of its own (the API supports `?search=`).
- **Missing bills** (`MissingBillsList`, `MonthStepper`): one month at a time (the backend's default first), each tenancy with **Create bill**, which opens the new-bill form on that month (`?month=YYYY-MM`). These are never counted in the totals.
- **Tests:** the dashboard is where sign-in lands, so `src/test/setup.ts` mocks `dashboard.service` with `src/test/mocks/dashboardService.ts` for every test ([testing.md](testing.md)).
