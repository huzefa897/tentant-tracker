"""The property dashboard: which months' rent is due or overdue, whether each one's bill is
prepared, and what's known to be outstanding.

The rows are rental periods (billing/periods.py), so a month is due or overdue on its schedule
whether or not its bill exists. Amounts come only from prepared bills: active ones, with
reversed payments left out (models.outstanding_sql, the definition bill lists use too). A month
without a bill has no amount, never a zero: it's counted as awaiting a bill and left out of
every sum. Everything is counted and summed in the database across the whole property before
any paging.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from django.db.models import Count, DecimalField, Min, Q, Sum, Value
from django.db.models.functions import Coalesce

from properties.models import Property

from .models import RentalPeriod
from .periods import DUE_SOON_DAYS

TIMING_FILTERS = ("due", "overdue", "due_today", "upcoming", "all")
PREPARATION_FILTERS = ("all", "prepared", "not_prepared")

MONEY = DecimalField(max_digits=12, decimal_places=2)


@dataclass(frozen=True)
class Timing:
    """A period's due date against today at the property."""

    overdue: Q
    due_today: Q
    upcoming: Q

    @classmethod
    def on(cls, today: date) -> "Timing":
        return cls(
            overdue=Q(due_date__lt=today),
            due_today=Q(due_date=today),
            # Tomorrow up to and including a week from today.
            upcoming=Q(
                due_date__gt=today, due_date__lte=today + timedelta(days=DUE_SOON_DAYS)
            ),
        )

    def filter(self, name: str) -> Q:
        if name == "due":
            return self.overdue | self.due_today
        if name == "all":
            return Q()
        return getattr(self, name)


def timing_of(due_date: date, today: date) -> str:
    if due_date < today:
        return "overdue"
    if due_date == today:
        return "due_today"
    return "upcoming"


def owing_periods(prop: Property):
    return RentalPeriod.objects.filter(tenancy__property=prop).owing()


def _sum(condition: Q):
    return Coalesce(Sum("outstanding", filter=condition), Value(0), output_field=MONEY)


def summary(prop: Property, today: date) -> dict:
    """Counts of rental periods (not tenants, except where it says so) and the amounts known
    from prepared bills. The amounts never include a month awaiting its bill."""
    timing = Timing.on(today)
    billed = Q(has_bill=True)
    unbilled = Q(has_bill=False)
    return owing_periods(prop).aggregate(
        owed_periods=Count("pk"),
        overdue_periods=Count("pk", filter=timing.overdue),
        oldest_overdue_due_date=Min("due_date", filter=timing.overdue),
        overdue_tenancies=Count("tenancy", distinct=True, filter=timing.overdue),
        due_today_periods=Count("pk", filter=timing.due_today),
        upcoming_periods=Count("pk", filter=timing.upcoming),
        awaiting_bill_periods=Count("pk", filter=unbilled),
        overdue_awaiting_bill_periods=Count("pk", filter=unbilled & timing.overdue),
        owing_tenancies=Count("tenancy", distinct=True),
        known_outstanding=_sum(billed),
        known_overdue=_sum(billed & timing.overdue),
        known_due_today=_sum(billed & timing.due_today),
        known_upcoming=_sum(billed & timing.upcoming),
    )


def periods(
    prop: Property,
    today: date,
    timing: str = "due",
    preparation: str = "all",
    month: date | None = None,
):
    """One row per rental period still owed (or awaiting its bill), oldest due first. `timing`
    keeps due (overdue or due today, the default), overdue, due_today, upcoming (the next 7
    days) or all of them; `preparation` keeps prepared or not_prepared bills; `month` one
    rental month."""
    if timing not in TIMING_FILTERS:
        raise ValueError(f"Unknown timing filter: {timing}")
    if preparation not in PREPARATION_FILTERS:
        raise ValueError(f"Unknown preparation filter: {preparation}")

    rows = owing_periods(prop).filter(Timing.on(today).filter(timing))
    if preparation != "all":
        rows = rows.filter(has_bill=preparation == "prepared")
    if month is not None:
        rows = rows.filter(period_month=month)
    return rows.values(
        "id",
        "tenancy_id",
        "tenancy__name",
        "tenancy__flat_number",
        "tenancy__start_date",
        "tenancy__end_date",
        "period_month",
        "payment_timing",
        "due_date",
        "has_bill",
        "bill_id",
        "bill_total",
        "bill_paid",
        "outstanding",
    ).order_by("due_date", "tenancy__name", "tenancy__flat_number", "period_month", "id")
