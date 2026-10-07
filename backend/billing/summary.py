"""A summary of everything the database holds that matters for recovery: counts, money totals
and checksums. Two databases with the same summary hold the same people, access, bills,
payments and receipts (scripts/restore-test.sh compares a restored backup with the live one).

Only counts, totals and hashes: never names, phone numbers or amounts per person.
"""

import hashlib
from decimal import Decimal

from django.contrib.auth import get_user_model

from billing.calculations import ZERO, entry_amounts
from billing.models import Payment, Receipt, RentEntry
from properties.models import Property, PropertyMembership, Tenancy

# The snapshot fields printed on a receipt: a restored receipt must match on every one.
RECEIPT_FIELDS = [
    field.name
    for field in Receipt._meta.get_fields()
    if field.concrete and field.name not in ("id", "payment", "issued_by")
]


def _digest(rows) -> str:
    """A hash of rows, in a fixed order: equal only if every row matches."""
    digest = hashlib.sha256()
    for row in sorted("|".join(str(value) for value in row) for row in rows):
        digest.update(row.encode())
        digest.update(b"\n")
    return digest.hexdigest()[:16]


def ledger_summary() -> list[tuple[str, str]]:
    entries = list(RentEntry.objects.prefetch_related("payments"))
    amounts = {
        entry.pk: entry_amounts(entry, total_paid=sum((p.amount for p in entry.payments.all()), ZERO))
        for entry in entries
    }
    total_due = sum((a.total_due for a in amounts.values()), Decimal("0.00"))
    total_paid = sum((a.total_paid for a in amounts.values()), Decimal("0.00"))
    memberships = PropertyMembership.objects.values_list(
        "user_id", "property_id", "role", "is_active"
    )

    return [
        ("people", str(get_user_model().objects.count())),
        ("properties", str(Property.objects.count())),
        ("memberships", str(memberships.count())),
        ("memberships digest", _digest(memberships)),
        ("tenancies", str(Tenancy.objects.count())),
        ("bills", str(len(entries))),
        ("payments", str(Payment.objects.count())),
        ("receipts", str(Receipt.objects.count())),
        ("total billed", str(total_due)),
        ("total paid", str(total_paid)),
        ("total outstanding", str(total_due - total_paid)),
        (
            "bills digest",
            _digest(
                (
                    entry.pk,
                    entry.tenancy_id,
                    entry.billing_month,
                    amounts[entry.pk].total_due,
                    amounts[entry.pk].total_paid,
                    amounts[entry.pk].outstanding_amount,
                )
                for entry in entries
            ),
        ),
        (
            "payments digest",
            _digest(
                Payment.objects.values_list(
                    # The sequence too: receipts total a bill's payments in that order.
                    "id", "entry_id", "sequence", "amount", "paid_date", "notes"
                )
            ),
        ),
        (
            "receipts digest",
            _digest(Receipt.objects.values_list("payment_id", *RECEIPT_FIELDS)),
        ),
    ]
