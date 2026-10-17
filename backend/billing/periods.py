"""Rental periods: each tenancy's months of rent, and when each one is due.

A month becomes due on the tenancy's schedule, whether or not its bill has been prepared. The
periods are created on demand, never by a scheduled job: whatever reads them (the dashboard)
first calls ensure_property_periods, which creates any that are missing up to a week ahead, so
a day of downtime or a missed run never hides a month. Creating them is idempotent (one per
tenancy and month, ON CONFLICT DO NOTHING), so two requests at once can't duplicate one.

A period's due date is worked out once, when it's created, from the property's payment timing
and the tenancy's due day at that moment. Before either setting changes, the periods due under
the old one are created first (freeze_before_change), so a change never rewrites a month that
was already due.
"""

from datetime import date, timedelta

from properties.models import Property, Tenancy, business_date

from .calculations import due_date_for
from .models import RentalPeriod

# How far ahead periods are created: the dashboard shows what's due in the next 7 days.
DUE_SOON_DAYS = 7


def next_month(month: date) -> date:
    if month.month == 12:
        return month.replace(year=month.year + 1, month=1)
    return month.replace(month=month.month + 1)


def new_period(tenancy: Tenancy, prop: Property, month: date) -> RentalPeriod:
    timing = prop.payment_timing
    return RentalPeriod(
        tenancy=tenancy,
        period_month=month,
        payment_timing=timing,
        due_day=tenancy.rent_due_day,
        due_date=due_date_for(month, tenancy.rent_due_day, timing),
    )


def scheduled_months(tenancy: Tenancy, prop: Property, today: date) -> list[date]:
    """The months the schedule says are owed by a week from today: from the tenancy's first
    month (or the property's tracking cut-off, when that's later) through its last month,
    stopping at the first month due after the horizon."""
    horizon = today + timedelta(days=DUE_SOON_DAYS)
    month = tenancy.start_date.replace(day=1)
    if prop.rent_tracking_start is not None:
        month = max(month, prop.rent_tracking_start)
    months = []
    while tenancy.end_date is None or month <= tenancy.end_date:
        if due_date_for(month, tenancy.rent_due_day, prop.payment_timing) > horizon:
            break
        months.append(month)
        month = next_month(month)
    return months


def _create(periods: list[RentalPeriod]) -> None:
    # The unique (tenancy, month) constraint decides: one that already exists is left as it is.
    RentalPeriod.objects.bulk_create(periods, ignore_conflicts=True)


def ensure_periods(tenancy: Tenancy, today: date, prop: Property | None = None) -> None:
    """Creates the tenancy's scheduled periods that don't exist yet."""
    prop = prop or tenancy.property
    _create([new_period(tenancy, prop, month) for month in scheduled_months(tenancy, prop, today)])


def ensure_property_periods(prop: Property, today: date) -> None:
    """Creates every scheduled period of the property's tenancies that doesn't exist yet."""
    horizon = today + timedelta(days=DUE_SOON_DAYS)
    tenancies = Tenancy.objects.filter(property=prop, start_date__lte=horizon)
    if prop.rent_tracking_start is not None:
        tenancies = tenancies.exclude(end_date__lt=prop.rent_tracking_start)
    _create(
        [
            new_period(tenancy, prop, month)
            for tenancy in tenancies
            for month in scheduled_months(tenancy, prop, today)
        ]
    )


def period_for_bill(tenancy: Tenancy, month: date) -> RentalPeriod:
    """The period a bill for this month belongs to, created now if it doesn't exist (a month
    before the tracking cut-off, or not yet due). Call it while holding the tenancy's lock, as bill
    creation does."""
    _create([new_period(tenancy, tenancy.property, month)])
    return RentalPeriod.objects.get(tenancy=tenancy, period_month=month)


def freeze_before_change(*, tenancy: Tenancy | None = None, prop: Property | None = None):
    """Creates the periods due by now under the settings as they're stored, before a change to
    a tenancy's due day or a property's payment timing is saved: months already due keep the
    date they had. Pass the stored (unchanged) instances."""
    today = business_date()
    if tenancy is not None:
        ensure_periods(tenancy, today)
    if prop is not None:
        ensure_property_periods(prop, today)
