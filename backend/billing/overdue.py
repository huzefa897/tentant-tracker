"""Overdue bills: active bills past their due date with money still to pay, grouped by tenancy,
across every property the user has access to.

Only bills count here; a month without a bill is the rent-due list's (billing/dashboard.py),
never treated as paid or owed. Amounts are the one SQL definition (models.outstanding_sql):
void bills and reversed payments count for nothing, as on the bill page. A bill is due when its
rental period is (RentEntryQuerySet.with_due), so a bill prepared late keeps its month's date.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from django.db.models import Q, QuerySet

from properties.models import Property, Tenancy

from .models import RentEntry

SEARCH_MAX_LENGTH = 100


def search_terms(search: str) -> str:
    """'  Flat 102 ' -> '102': what was typed, without a leading "flat", as owners say it."""
    terms = " ".join(search.split())
    if terms.lower().startswith("flat "):
        terms = terms[5:].strip()
    return terms


def overdue_bills(
    properties: QuerySet[Property],
    today: date,
    property_id=None,
    month: date | None = None,
    search: str = "",
):
    """Each overdue bill with its amounts, its tenancy and property, oldest due first."""
    bills = (
        RentEntry.objects.filter(tenancy__property__in=properties)
        .with_amounts()
        .with_due()
        .owing()
        .filter(period_due_date__lt=today)
    )
    if property_id is not None:
        bills = bills.filter(tenancy__property_id=property_id)
    if month is not None:
        bills = bills.filter(billing_month=month)
    terms = search_terms(search)
    if terms:
        bills = bills.filter(
            Q(tenancy__name__icontains=terms) | Q(tenancy__flat_number__icontains=terms)
        )
    return bills.values(
        "id",
        "billing_month",
        "period_due_date",
        "due_total",
        "paid_total",
        "outstanding_total",
        "tenancy_id",
        "tenancy__name",
        "tenancy__flat_number",
        "tenancy__start_date",
        "tenancy__end_date",
        "tenancy__property_id",
        "tenancy__property__name",
    ).order_by("period_due_date", "billing_month", "id")


@dataclass
class OverdueTenancy:
    tenancy_id: object
    name: str
    flat_number: str
    tenancy_status: str
    property_id: object
    property_name: str
    bills: list = field(default_factory=list)

    @property
    def outstanding(self) -> Decimal:
        return sum((bill["outstanding_total"] for bill in self.bills), Decimal("0.00"))

    @property
    def oldest_due_date(self) -> date:
        return self.bills[0]["period_due_date"]


def by_tenancy(bills, today: date) -> list[OverdueTenancy]:
    """The bills (oldest due first) grouped by tenancy: the tenancy with the oldest overdue bill
    first, then by name, flat and property. Each keeps its bills oldest due first."""
    groups: dict = {}
    for bill in bills:
        group = groups.get(bill["tenancy_id"])
        if group is None:
            dates = Tenancy(
                start_date=bill["tenancy__start_date"], end_date=bill["tenancy__end_date"]
            )
            group = groups[bill["tenancy_id"]] = OverdueTenancy(
                tenancy_id=bill["tenancy_id"],
                name=bill["tenancy__name"],
                flat_number=bill["tenancy__flat_number"],
                tenancy_status=dates.status_on(today),
                property_id=bill["tenancy__property_id"],
                property_name=bill["tenancy__property__name"],
            )
        group.bills.append(bill)
    return sorted(
        groups.values(),
        key=lambda group: (
            group.oldest_due_date,
            group.name.lower(),
            group.flat_number,
            group.property_name.lower(),
            str(group.tenancy_id),
        ),
    )
