"""The months still owed, read through billing's own definition (RentalPeriod.objects.owing(),
the one the dashboard uses), so messaging never has its own idea of what's paid.

A month without a bill is owed (payments need a bill); a month marked not owed, a void bill and
reversed payments don't count; a part-paid month is still owed.
"""

from collections import defaultdict
from datetime import date
from uuid import UUID

from billing.models import RentalPeriod
from billing.periods import ensure_property_periods
from properties.models import Property, Tenancy

from .models import RentDueReminderItem
from .policy import OwedMonth


def owed_months(prop: Property, today: date, reminders_start: date) -> dict[Tenancy, list[OwedMonth]]:
    """Each **current** tenancy's months due by today (and on or after reminders start) that are
    still owed. Ended and future tenancies are left out. Rental periods are created by their
    reads, so this creates any that are due first, as the dashboard does."""
    ensure_property_periods(prop, today)
    tenancies = {t.pk: t for t in Tenancy.objects.filter(property=prop).current(today)}
    rows = (
        RentalPeriod.objects.filter(
            tenancy_id__in=tenancies, due_date__lte=today, due_date__gte=reminders_start
        )
        .owing()
        .values_list("pk", "tenancy_id", "period_month", "due_date")
    )
    owed: dict[Tenancy, list[OwedMonth]] = defaultdict(list)
    for period_id, tenancy_id, period_month, due_date in rows:
        owed[tenancies[tenancy_id]].append(OwedMonth(period_id, period_month, due_date))
    return dict(owed)


def reminded(period_ids) -> set[tuple[UUID, str]]:
    """The (period id, stage) pairs that already have a reminder item, sent or not."""
    return set(
        RentDueReminderItem.objects.filter(rental_period_id__in=period_ids).values_list(
            "rental_period_id", "stage"
        )
    )


def still_owed(period_ids) -> set[UUID]:
    return set(RentalPeriod.objects.filter(pk__in=period_ids).owing().values_list("pk", flat=True))
