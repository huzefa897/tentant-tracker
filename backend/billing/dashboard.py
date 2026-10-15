"""The property dashboard: who owes money, how much of it is late, and which months have no bill.

Every figure comes from recorded bills: active ones only, with reversed payments left out
(models.outstanding_sql, the definition bill lists use too), summed in the database across the
whole property before any paging. A bill without a due date (from before due dates) counts
towards what's outstanding but can't be overdue, due today or due soon: it's reported apart
(without_due_date) so it isn't mistaken for money that's on time.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from django.db.models import Count, DecimalField, Exists, F, Min, OuterRef, Q, Sum, Value
from django.db.models.functions import Coalesce

from properties.models import PaymentTiming, Property, Tenancy

from .models import RentEntry, month_end, outstanding_sql

# Due next 7 days: tomorrow up to and including a week from today.
DUE_SOON_DAYS = 7

DUE_FILTERS = ("all", "overdue", "due_today", "due_next_7_days")

MONEY = DecimalField(max_digits=12, decimal_places=2)


@dataclass(frozen=True)
class DueWindows:
    """The due-date conditions on a bill, for today at the property."""

    overdue: Q
    due_today: Q
    due_next_7_days: Q
    without_due_date: Q

    @classmethod
    def on(cls, today: date) -> "DueWindows":
        return cls(
            overdue=Q(due_date__lt=today),
            due_today=Q(due_date=today),
            due_next_7_days=Q(
                due_date__gt=today, due_date__lte=today + timedelta(days=DUE_SOON_DAYS)
            ),
            without_due_date=Q(due_date__isnull=True),
        )


def _owing_bills(prop: Property):
    """The property's active bills with money still to pay, as a fresh queryset with no
    annotations, so grouping and summing it can't group by a bill's own figures."""
    owing = RentEntry.objects.filter(tenancy__property=prop).with_amounts().owing().values("pk")
    return RentEntry.objects.filter(pk__in=owing)


def _sum(condition: Q | None = None):
    return Coalesce(Sum(outstanding_sql(), filter=condition), Value(0), output_field=MONEY)


def summary(prop: Property, today: date) -> dict:
    """Property-wide totals. Overdue, due today and due soon are parts of what's outstanding,
    never amounts to add to it."""
    windows = DueWindows.on(today)
    return _owing_bills(prop).aggregate(
        outstanding=_sum(),
        overdue=_sum(windows.overdue),
        due_today=_sum(windows.due_today),
        due_next_7_days=_sum(windows.due_next_7_days),
        without_due_date=_sum(windows.without_due_date),
        pending_tenancies=Count("tenancy", distinct=True),
        overdue_tenancies=Count("tenancy", distinct=True, filter=windows.overdue),
    )


def pending_tenancies(prop: Property, today: date, due: str = "all", search: str = ""):
    """One row per tenancy that owes money (an ended one too), with its totals, ordered with
    the overdue first, oldest overdue first, then by name and id. `due` keeps the tenancies with
    money in that window; `search` matches the tenant's name or flat number."""
    if due not in DUE_FILTERS:
        raise ValueError(f"Unknown due filter: {due}")
    windows = DueWindows.on(today)

    rows = (
        _owing_bills(prop)
        .values(
            "tenancy_id",
            "tenancy__name",
            "tenancy__flat_number",
            "tenancy__start_date",
            "tenancy__end_date",
        )
        .annotate(
            outstanding=_sum(),
            overdue=_sum(windows.overdue),
            due_today=_sum(windows.due_today),
            due_next_7_days=_sum(windows.due_next_7_days),
            without_due_date=_sum(windows.without_due_date),
            bill_count=Count("pk"),
            oldest_due_date=Min("due_date"),
            oldest_overdue_date=Min("due_date", filter=windows.overdue),
        )
    )
    if due != "all":
        rows = rows.filter(**{f"{due}__gt": 0})
    search = " ".join(search.split())
    if search:
        rows = rows.filter(
            Q(tenancy__name__icontains=search) | Q(tenancy__flat_number__icontains=search)
        )
    return rows.order_by(
        F("oldest_overdue_date").asc(nulls_last=True),
        F("oldest_due_date").asc(nulls_last=True),
        "tenancy__name",
        "tenancy_id",
    )


def default_missing_month(prop: Property, today: date) -> date:
    """The month whose bills should exist by now: last month when rent is postpaid (its
    electricity is read after it ends), this month when it's prepaid."""
    this_month = today.replace(day=1)
    if prop.payment_timing == PaymentTiming.PREPAID:
        return this_month
    return (this_month - timedelta(days=1)).replace(day=1)


def missing_bills(prop: Property, billing_month: date):
    """Tenancies occupying any day of the month with no active bill for it. Nothing is estimated
    for them: a missing bill isn't money owed until it's recorded."""
    billed = RentEntry.objects.active().filter(
        tenancy=OuterRef("pk"), billing_month=billing_month
    )
    return (
        Tenancy.objects.filter(property=prop, start_date__lte=month_end(billing_month))
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=billing_month))
        .exclude(Exists(billed))
        .order_by("flat_number", "name", "id")
    )
