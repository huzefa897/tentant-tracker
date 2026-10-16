# Property dashboard

The dashboard answers, for the selected property: which months' rent is due or overdue, whether each one's bill is prepared, and how much is known to be outstanding. A month is due on the tenancy's schedule whether or not its bill exists ([rent-entries.md](rent-entries.md#rental-periods-and-due-dates)).

## What counts

- **Rows are rental periods**, one per tenancy and month, never bills: a month without a bill is still due or overdue. Months count once the property tracks rent (`Property.rent_tracking_start`) and within the tenancy's dates; a month with a bill always counts. Months marked **not owed** never do.
- **Amounts come only from prepared bills.** Active bills, with the payments that weren't reversed; void bills count for nothing. A month awaiting its bill has no amount: it's `null` in the API, never `"0.00"`, and it's left out of every sum (the summary counts how many). Nothing is estimated, not even the rent.
- **One definition** of a bill's amounts in SQL (`billing/models.py`: `effective_paid_sql`, `total_due_sql`, `outstanding_sql`), used by bill lists, their filters (`RentEntry.objects.with_amounts()`, `.owing()`) and the dashboard (`RentalPeriod.objects.with_bill()`, `.counted()`, `.owing()`). Payments are summed in a subquery per bill, never joined, so nothing is counted once per payment.
- **Timing**, on today in India (`business_date()`, once per request) against the period's saved due date: **overdue** (due date before today, with the days overdue), **due today**, **upcoming** (tomorrow to a week from today). No grace period.
- **Settlement**: **unknown** (no bill), then **unpaid**, **partially paid** or **paid** from the bill's effective payments. A reversal makes a month owed again, from its original due date.
- **Periods are created by the reads themselves** (`periods.ensure_property_periods`, at the start of every dashboard request), so a day of downtime or no visits never hides a month. No scheduled job.
- Everything is counted and summed in the database across the whole property before paging (`billing/dashboard.py`); the list's filters never change the summary.

## API

Reads are for anyone with access to the property (`properties_for_user`; another property 404s). Money is a decimal string.

- `GET /api/v1/properties/{id}/dashboard/summary/`: `asOfDate`, `generatedAt`, `currency`; counts of **rental periods**: `overduePeriodCount`, `dueTodayPeriodCount`, `upcomingPeriodCount`, `awaitingBillPeriodCount` (owed months with no bill, left out of the amounts), `overdueAwaitingBillPeriodCount`; counts of **tenancies**: `overdueTenancyCount`, `owingTenancyCount`; and amounts known from prepared bills: `knownOutstandingAmount`, `knownOverdueAmount`, `knownDueTodayAmount`, `knownUpcomingAmount`.
- `GET .../dashboard/rental-periods/`: one row per month still owed or awaiting its bill, oldest due first (then name, flat, month): `id`, `tenancyId`, `name`, `flatNumber`, `tenancyStatus`, `periodMonth` (`YYYY-MM`), `paymentTiming`, `dueDate`, `timing`, `daysOverdue`, `preparation` (`prepared` | `not_prepared`), `billId`, `settlement`, `totalDue` and `outstandingAmount` (both `null` without a bill), and `actions`: `prepare_bill` and `mark_not_owed` (owners) without a bill, or `view_bill` and `record_payment` with one, only those the viewer's role allows. `?timing=due` (the default: overdue or due today) `|overdue|due_today|upcoming|all`, `?preparation=all|prepared|not_prepared`, `?month=YYYY-MM`; 20 a page (`?page=`). Its query count doesn't grow with months, bills or payments (tested).
- `POST /api/v1/properties/{id}/rental-periods/{periodId}/not-owed/` `{"reason"}`: marks a month not owed (waived, or settled outside the app). Owners only (403 for a manager), 201 with the period and who, when and why; a retry with the same reason is 200, another reason 409 `not_owed_conflict`; a month with an active bill is 409 `period_has_bill` (void the bill first). It can't have a bill afterwards.
- **A tenancy's unpaid bills:** the bills list takes `?balance=outstanding` (active bills with money still to pay), with the rest of its filters and paging ([rent-entries.md](rent-entries.md)).
