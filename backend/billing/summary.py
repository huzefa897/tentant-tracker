"""A summary of everything the database holds that matters for recovery: counts, money totals
and checksums. Two databases with the same summary hold the same people, properties, access,
tenancies, bills (void or not), payments, reversals and receipts (void or not), down to their
details (scripts/restore-test.sh compares a restored backup with the live one).

Only counts, totals and hashes: never names, phone numbers or amounts per person.
"""

import hashlib
import json
from decimal import Decimal

from django.contrib.auth import get_user_model

from billing.calculations import entry_amounts
from billing.models import Payment, PaymentReversal, Receipt, RentEntry
from properties.models import Property, PropertyMembership, Tenancy

# The snapshot fields printed on a receipt: a restored receipt must match on every one.
RECEIPT_FIELDS = [
    field.name
    for field in Receipt._meta.get_fields()
    if field.concrete and field.name not in ("id", "payment", "issued_by")
]


def _fields(model, leave_out=()) -> list[str]:
    """Every stored column of a model (foreign keys as their ids), so a field added later is
    covered without changing this file."""
    return [f.attname for f in model._meta.concrete_fields if f.name not in leave_out]


# People's details, contact numbers, Firebase links and password hashes, but not last_login:
# it changes whenever someone signs in to admin, which a restore test shouldn't report.
PERSON_FIELDS = _fields(get_user_model(), leave_out=("last_login",))
PROPERTY_FIELDS = _fields(Property)
TENANCY_FIELDS = _fields(Tenancy)


def _encode(row) -> str:
    """One row as JSON: strings are quoted and escaped, so no field's text (a "|" or a line
    break in a name or address) can pass for a field or row boundary, and an empty (None)
    field stays apart from the text "None". Dates, decimals and ids go as their text."""
    return json.dumps(list(row), default=str)


def _digest(rows) -> str:
    """A hash of rows, in a fixed order: equal only if every row matches."""
    digest = hashlib.sha256()
    for row in sorted(_encode(row) for row in rows):
        digest.update(row.encode())
        digest.update(b"\n")
    return digest.hexdigest()[:16]


def ledger_summary() -> list[tuple[str, str]]:
    # Reversed payments don't count towards the totals (with_amounts sums the effective ones),
    # and nor do void bills (kept as history, owing nothing).
    entries = list(RentEntry.objects.with_amounts())
    amounts = {entry.pk: entry_amounts(entry) for entry in entries}
    active = [amounts[entry.pk] for entry in entries if entry.status == RentEntry.Status.ACTIVE]
    total_due = sum((a.total_due for a in active), Decimal("0.00"))
    total_paid = sum((a.total_paid for a in active), Decimal("0.00"))
    memberships = PropertyMembership.objects.values_list(
        "user_id", "property_id", "role", "is_active"
    )

    return [
        ("people", str(get_user_model().objects.count())),
        ("people digest", _digest(get_user_model().objects.values_list(*PERSON_FIELDS))),
        ("properties", str(Property.objects.count())),
        ("properties digest", _digest(Property.objects.values_list(*PROPERTY_FIELDS))),
        ("memberships", str(memberships.count())),
        ("memberships digest", _digest(memberships)),
        ("tenancies", str(Tenancy.objects.count())),
        ("tenancies digest", _digest(Tenancy.objects.values_list(*TENANCY_FIELDS))),
        ("bills", str(len(entries))),
        ("void bills", str(len(entries) - len(active))),
        ("payments", str(Payment.objects.count())),
        ("payment reversals", str(PaymentReversal.objects.count())),
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
                    entry.payment_timing,
                    entry.due_date,
                    entry.status,
                    entry.voided_at,
                    entry.voided_by_id,
                    entry.void_reason,
                    entry.replaces_entry_id,
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
            "payment reversals digest",
            _digest(
                PaymentReversal.objects.values_list(
                    "id", "payment_id", "reason", "created_by_id", "created_at"
                )
            ),
        ),
        (
            "receipts digest",
            _digest(Receipt.objects.values_list("payment_id", *RECEIPT_FIELDS)),
        ),
    ]
